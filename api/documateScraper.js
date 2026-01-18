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
      
      // ============================================================
      // STRATEGY 1: PUBMED API (Bypass 403 Blocking entirely)
      // ============================================================
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
                          return {
                              url,
                              status: "ok",
                              title: result.title,
                              meta: { author: authorStr, date: dateStr, site: "PubMed" },
                              content: `Title: ${result.title}. Author: ${authorStr}. Date: ${dateStr}. Source: PubMed.`
                          };
                      }
                  }
              }
          } catch (e) { console.warn("PubMed API failed", e); }
      }

      // ============================================================
      // STRATEGY 2: DOI LOOKUP (Crossref API for Academic Papers)
      // ============================================================
      const doiMatch = url.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
      if (doiMatch) {
          try {
              const crossrefUrl = `https://api.crossref.org/works/${doiMatch[1]}`;
              const resp = await fetch(crossrefUrl);
              if (resp.ok) {
                  const data = await resp.json();
                  const item = data.message;
                  const authors = item.author ? item.author.map(a => `${a.given} ${a.family}`).join(', ') : "";
                  let date = "";
                  if (item.published && item.published['date-parts']) date = item.published['date-parts'][0].join('-');
                  
                  return {
                      url,
                      status: "ok",
                      title: item.title ? item.title[0] : "",
                      meta: { author: authors, date: date, site: item['container-title'] ? item['container-title'][0] : "Journal" },
                      content: `Title: ${item.title}. Author: ${authors}. Date: ${date}. Abstract: ${item.abstract || ""}`
                  };
              }
          } catch (e) { console.warn("DOI Lookup failed", e); }
      }

      // ============================================================
      // STRATEGY 3: ROBUST SCRAPER (McKinsey, News, Blogs)
      // ============================================================
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'cross-site'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        let author = "";
        let date = "";
        let site = "";
        let title = "";

        // 1. Title
        title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();

        // 2. JSON-LD (Best for McKinsey/News)
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                const objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                const article = objects.find(o => ['Article', 'NewsArticle', 'Report', 'BlogPosting'].includes(o['@type']));
                if (article) {
                    if (!date) date = article.datePublished || article.dateCreated;
                    if (!author && article.author) {
                        if (Array.isArray(article.author)) author = article.author.map(a => a.name || a).join(', ');
                        else author = article.author.name || article.author;
                    }
                    if (!site && article.publisher) site = article.publisher.name || article.publisher;
                }
            } catch(e) {}
        });

        // 3. Meta Tags
        if (!author) {
            const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author'];
            const found = [];
            authorTags.forEach(tag => {
                $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                    const val = $(el).attr('content');
                    if (val && !found.includes(val)) found.push(val);
                });
            });
            if (found.length > 0) author = found.join(', ');
        }

        if (!date) {
            date = $('meta[name="citation_publication_date"]').attr('content') || 
                   $('meta[name="date"]').attr('content') || 
                   $('meta[property="article:published_time"]').attr('content');
        }

        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || "Website";
        }

        // 4. DOM Fallbacks (McKinsey often puts authors in .text-link or .author-name)
        if (!author) {
            const selectors = ['.author-name', '.byline', '.text-link', '.author', '.contributors'];
            for (const sel of selectors) {
                const text = $(sel).first().text().trim();
                if (text && text.length > 3 && text.length < 100) {
                    author = text.replace(/^By\s+/i, '').trim();
                    break;
                }
            }
        }

        // 5. Cleanup
        if (author) author = author.replace(/Author links open overlay panel/gi, '').trim();
        if (date && date.includes('T')) date = date.split('T')[0];

        // 6. Text Extraction
        $('script, style, nav, footer, svg, noscript, iframe, aside').remove();
        $('br, div, p, h1, h2, li').after(' ');
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // 7. Regex Fallback
        if (!author) {
            const byMatch = bodyText.substring(0, 1000).match(/(?:By|Written by)\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:,\s+[A-Z][a-z]+\s+[A-Z][a-z]+)*)/i);
            if (byMatch) author = byMatch[1];
        }

        // 8. Construct Content
        let richContent = `Title: ${title}. `;
        if (author) richContent += `Author: ${author}. `;
        if (date) richContent += `Date: ${date}. `;
        if (site) richContent += `Source: ${site}. `;
        richContent += "\n\n" + bodyText.substring(0, 2000);

        return { 
            url, 
            status: "ok", 
            title: title || "", 
            meta: { author: author || "", date: date || "", site: site || "" }, 
            content: richContent 
        };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
