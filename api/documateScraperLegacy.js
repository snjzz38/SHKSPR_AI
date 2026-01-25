import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // 2. Process URLs (Max 10)
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        // Increased timeout to 8s as requested for heavy sites
        const timeoutId = setTimeout(() => controller.abort(), 8000); 

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

        // --- 1. EXTRACT TITLE ---
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('h1').first().text().trim() || 
                $('title').text().trim();

        // --- 2. DEEP JSON-LD EXTRACTION ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                let objects = [];
                if (Array.isArray(json)) objects = json;
                else if (json['@graph'] && Array.isArray(json['@graph'])) objects = json['@graph'];
                else objects = [json];

                const article = objects.find(o => 
                    ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type'])
                );

                if (article) {
                    if (!date) date = article.datePublished || article.dateCreated || article.dateModified;
                    
                    if (!author && article.author) {
                        if (typeof article.author === 'string') author = article.author;
                        else if (Array.isArray(article.author)) author = article.author.map(a => a.name || a).join(', ');
                        else if (article.author.name) author = article.author.name;
                    }

                    if (!site && article.publisher) {
                        if (typeof article.publisher === 'string') site = article.publisher;
                        else if (article.publisher.name) site = article.publisher.name;
                    }
                }
            } catch(e) {}
        });

        // --- 3. META TAGS FALLBACK ---
        if (!author) {
            const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'twitter:creator'];
            const authorsFound = [];
            authorTags.forEach(tag => {
                $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                    const val = $(el).attr('content');
                    if (val && !authorsFound.includes(val)) authorsFound.push(val);
                });
            });
            if (authorsFound.length > 0) author = authorsFound.join(', ');
        }

        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time'];
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

        // --- 4. HTML SELECTORS FALLBACK ---
        if (!author) {
            const authorSelectors = ['a[rel="author"]', '.author-name', '.byline', '.author', '.contributors'];
            for (const sel of authorSelectors) {
                const text = $(sel).first().text().trim();
                if (text && text.length > 2 && text.length < 100) {
                    author = text.replace(/\s+/g, ' ').trim();
                    break;
                }
            }
        }

        if (!date) {
            const timeVal = $('time').first().attr('datetime') || $('time').first().text().trim();
            if (timeVal) date = timeVal;
        }

        // --- 5. CLEANUP ---
        if (author) author = author.replace(/By\s+/i, '').replace(/^,\s*/, '').trim();
        if (date && date.includes('T')) date = date.split('T')[0]; // ISO to YYYY-MM-DD

        // --- 6. TEXT EXTRACTION ---
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement').remove();
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 7. FINAL REGEX FALLBACK ---
        if (!author) {
            const byMatch = bodyText.substring(0, 500).match(/By\s*([A-Z][a-z]+\s[A-Z][a-z]+)/);
            if (byMatch) author = byMatch[1];
        }

        // --- 8. CONSTRUCT RICH CONTENT ---
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
