import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // CORS Setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      
      // --- HELPER: DOI LOOKUP (The "Professional" Method) ---
      // If we find a DOI, we query Crossref instead of scraping the messy HTML.
      const fetchDOI = async (doi) => {
          try {
              const crossrefUrl = `https://api.crossref.org/works/${doi}`;
              const resp = await fetch(crossrefUrl);
              if (resp.ok) {
                  const data = await resp.json();
                  const item = data.message;
                  
                  // Extract Authors
                  let authors = "";
                  if (item.author) {
                      authors = item.author.map(a => `${a.given} ${a.family}`).join(', ');
                  }
                  
                  // Extract Date (Parts: [Year, Month, Day])
                  let date = "";
                  if (item.published && item.published['date-parts']) {
                      date = item.published['date-parts'][0].join('-');
                  } else if (item.created) {
                      date = item.created['date-time'].split('T')[0];
                  }

                  return {
                      url,
                      status: "ok",
                      title: item.title ? item.title[0] : "",
                      meta: {
                          author: authors,
                          date: date,
                          site: item['container-title'] ? item['container-title'][0] : "Crossref Source"
                      },
                      content: `Title: ${item.title}\nAuthor: ${authors}\nDate: ${date}\nAbstract: ${item.abstract || "No abstract available via DOI."}`
                  };
              }
          } catch (e) {
              console.warn("DOI Lookup failed", e);
          }
          return null;
      };

      // 1. Check URL for DOI immediately (Fastest)
      const urlDoiMatch = url.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
      if (urlDoiMatch) {
          const doiResult = await fetchDOI(urlDoiMatch[1]);
          if (doiResult) return doiResult;
      }

      // --- STANDARD SCRAPER (Fallback) ---
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s for heavy sites

        // 2. ROBUST HEADERS (Mimic Real Browser to avoid 403/Aborted)
        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'cross-site',
                'Sec-Fetch-User': '?1'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // 3. CHECK HTML FOR DOI (If not in URL)
        // Many sites put the DOI in a meta tag
        const metaDoi = $('meta[name="citation_doi"]').attr('content') || 
                        $('meta[name="dc.identifier"]').attr('content');
        
        if (metaDoi && metaDoi.includes('10.')) {
            const doiResult = await fetchDOI(metaDoi);
            if (doiResult) return doiResult;
        }

        // --- 4. METADATA EXTRACTION ---
        let author = "";
        let date = "";
        let site = "";
        let title = "";

        // Title
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('h1').first().text().trim() || 
                $('title').text().trim();

        // JSON-LD (Structured Data)
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                const article = objects.find(o => ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type']));

                if (article) {
                    if (!date && (article.datePublished || article.dateCreated)) date = article.datePublished || article.dateCreated;
                    if (!site && article.publisher) site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    
                    // Authors
                    if (!author && article.author) {
                        if (Array.isArray(article.author)) {
                            author = article.author.map(a => a.name || a).join(', ');
                        } else if (article.author.name) {
                            author = article.author.name;
                        }
                    }
                }
            } catch(e) {}
        });

        // Meta Tags (Highwire / Dublin Core / Open Graph)
        if (!author) {
            const authors = [];
            const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author', 'sailthru.author'];
            authorTags.forEach(tag => {
                $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                    const val = $(el).attr('content');
                    if (val && !authors.includes(val)) authors.push(val);
                });
            });
            if (authors.length > 0) author = authors.join(', ');
        }

        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || 
                   $('meta[name="citation_journal_title"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');
        }

        // --- 5. DOM FALLBACKS (Visual Scraping) ---
        
        // Author Fallback (McKinsey/News style)
        if (!author) {
            // Check common byline classes
            const byline = $('.byline, .author, .authors, .contributor, .article-author').first().text().trim();
            if (byline && byline.length > 3 && byline.length < 100) {
                author = byline.replace(/^By\s+/i, '').trim();
            }
            
            // Regex Fallback
            if (!author) {
                const bodyText = $('body').text().replace(/\s+/g, ' ');
                const byMatch = bodyText.substring(0, 1500).match(/(?:By|Written by)\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:,\s+[A-Z][a-z]+\s+[A-Z][a-z]+)*)/i);
                if (byMatch) author = byMatch[1];
            }
        }

        // Date Fallback
        if (!date) {
            const timeTag = $('time').first().attr('datetime') || $('time').first().text().trim();
            if (timeTag) date = timeTag;
        }

        // --- 6. CLEANUP ---
        if (author) {
            author = author.replace(/Author links open overlay panel/gi, '').replace(/Show more/gi, '').trim();
        }
        if (date && date.includes('T')) date = date.split('T')[0];

        // Clean Content Extraction
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation').remove();
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // Construct Rich Content
        let richContent = "";
        if (title) richContent += `Title: ${title}. `;
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
