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
      
      // 1. PUBMED API
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
                          return {
                              url, status: "ok", title: result.title,
                              meta: { author: authorStr, date: result.pubdate || "", site: "PubMed" },
                              content: result.title
                          };
                      }
                  }
              }
          } catch (e) {}
      }

      // 2. DOI LOOKUP
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
                  
                  // Ensure site is string
                  let siteName = "Journal";
                  if (item['container-title']) {
                      siteName = Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'];
                  }

                  return {
                      url, status: "ok", title: item.title ? item.title[0] : "",
                      meta: { author: authors, date: date, site: siteName },
                      content: item.abstract || item.title
                  };
              }
          } catch (e) {}
      }

      // 3. STANDARD SCRAPER
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1'
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
        let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();

        // JSON-LD
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
                    if (!site && article.publisher) {
                        site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    }
                }
            } catch(e) {}
        });

        // Meta Tags
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

        if (!date) date = $('meta[name="citation_publication_date"]').attr('content') || $('meta[name="date"]').attr('content');
        if (!site) site = $('meta[property="og:site_name"]').attr('content');

        // DOM Fallbacks
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

        // Cleanup
        if (author) author = author.replace(/Author links open overlay panel/gi, '').trim();
        if (date && date.includes('T')) date = date.split('T')[0];
        
        // FIX: Ensure site is string
        if (typeof site === 'object') site = site.name || "";
        if (!site) site = "Website";

        // Content Extraction
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation').remove();
        $('br, div, p, h1, h2, li').after(' ');
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();
        let middleContent = "";

        if (bodyText.length <= 1000) {
            middleContent = bodyText;
        } else {
            const start = Math.max(0, Math.floor(bodyText.length / 2) - 500);
            middleContent = bodyText.substring(start, start + 1000);
        }
        if (bodyText.length > 1000) middleContent = "... " + middleContent + " ...";

        return { 
            url, 
            status: "ok", 
            title: title || "", 
            meta: { author: author || "", date: date || "", site: site }, 
            content: middleContent 
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
