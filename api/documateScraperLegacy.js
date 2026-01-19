import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      let scrapedData = null;

      // -------------------------------
      // 1. PUBMED API
      // -------------------------------
      if (url.includes('pubmed.ncbi.nlm.nih.gov')) {
        try {
          const idMatch = url.match(/\/(\d+)\/?/);
          if (idMatch) {
            const id = idMatch[1];
            const apiUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${id}&retmode=json`;
            const apiRes = await fetch(apiUrl);
            if (apiRes.ok) {
              const data = await apiRes.json();
              const result = data.result[id];
              if (result) {
                const authorStr = result.authors ? result.authors.map(a => a.name).join(', ') : "";
                const dateStr = result.pubdate || "";
                scrapedData = {
                  url,
                  status: "ok",
                  title: result.title,
                  meta: { author: authorStr, date: dateStr, site: "PubMed" },
                  content: `Title: ${result.title}. Author: ${authorStr}. Date: ${dateStr}. Source: PubMed.`
                };
                return scrapedData;
              }
            }
          }
        } catch(e) { console.warn("PubMed API failed", e); }
      }

      // -------------------------------
      // 2. DOI / Crossref API
      // -------------------------------
      const doiMatch = url.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
      if (doiMatch) {
        try {
          const doi = doiMatch[1];
          const crossrefUrl = `https://api.crossref.org/works/${doi}`;
          const resp = await fetch(crossrefUrl);
          if (resp.ok) {
            const data = await resp.json();
            const item = data.message;
            const authors = item.author ? item.author.map(a => `${a.given} ${a.family}`).join(', ') : "";
            let date = "";
            if (item.published && item.published['date-parts']) date = item.published['date-parts'][0].join('-');
            scrapedData = {
              url,
              status: "ok",
              title: item.title ? item.title[0] : "",
              meta: { author: authors, date: date, site: item['container-title'] ? item['container-title'][0] : "Journal" },
              content: `Title: ${item.title}. Author: ${authors}. Date: ${date}. Abstract: ${item.abstract || ""}`
            };
            return scrapedData;
          }
        } catch(e) { console.warn("Crossref lookup failed", e); }
      }

      // -------------------------------
      // 3. OpenAlex fallback (hard-to-scrape sources)
      // -------------------------------
      try {
        if (!scrapedData && process.env.OPENALEX_1) {
          if (doiMatch) {
            const doi = doiMatch[1];
            const openAlexUrl = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doi)}&mailto=${process.env.OPENALEX_1}`;
            const resp = await fetch(openAlexUrl);
            if (resp.ok) {
              const json = await resp.json();
              const work = json.results && json.results[0];
              if (work) {
                const authors = work.authorships ? work.authorships.map(a => a.author.display_name).join(', ') : "";
                const date = work.publication_date || "";
                scrapedData = {
                  url,
                  status: "ok",
                  title: work.title,
                  meta: { author: authors, date, site: work.host_venue?.display_name || "OpenAlex" },
                  content: `Title: ${work.title}. Author: ${authors}. Date: ${date}. Source: OpenAlex.`
                };
                return scrapedData;
              }
            }
          }
        }
      } catch(e) { console.warn("OpenAlex lookup failed", e); }

      // -------------------------------
      // 4. General HTML scraper fallback (first 1000 chars)
      // -------------------------------
      try {
        if (!scrapedData) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error(`Status ${response.status}`);
          const html = await response.text();
          const snippet = html.substring(0, 1000);
          const $ = cheerio.load(snippet);

          let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || "Unknown";
          let author = $('meta[name="author"]').attr('content') || "";
          let date = $('meta[name="date"]').attr('content') || "";

          scrapedData = {
            url,
            status: "ok",
            title,
            meta: { author, date, site: "HTML fallback" },
            content: snippet
          };
        }
      } catch(e) { return { url, status: "failed", error: e.message }; }

      return scrapedData;
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
