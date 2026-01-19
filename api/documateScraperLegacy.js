import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/* ============================================================
   DOMAIN STRATEGIES
============================================================ */
function getDomain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/* ============================================================
   MCKINSEY SCRAPER (JSON-LD ONLY, RANGE FETCH)
============================================================ */
async function scrapeMcKinsey(url) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 3000);

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html',
      'Range': 'bytes=0-6000'
    },
    signal: controller.signal
  });

  if (!res.ok) throw new Error('McKinsey fetch failed');

  const html = await res.text();
  const $ = cheerio.load(html);

  let title = '';
  let author = '';
  let date = '';
  const site = 'McKinsey & Company';

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      const objs = json['@graph'] || [json];
      const article = objs.find(o => o['@type'] === 'Article');
      if (article) {
        title = article.headline || '';
        date = article.datePublished || '';
        if (article.author) {
          author = Array.isArray(article.author)
            ? article.author.map(a => a.name).join(', ')
            : article.author.name;
        }
      }
    } catch {}
  });

  if (!author) author = 'McKinsey Global Institute';

  return {
    url,
    status: 'ok',
    title,
    meta: { author, date, site },
    content: `Title: ${title}. Author: ${author}. Date: ${date}. Source: McKinsey & Company.`
  };
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'No URLs provided' });
    }

    const results = await Promise.all(
      urls.slice(0, 10).map(async (url) => {
        try {
          const domain = getDomain(url);

          /* ============================================================
             DOMAIN OVERRIDES
          ============================================================ */
          if (domain.includes('mckinsey.com')) {
            return await scrapeMcKinsey(url);
          }

          /* ============================================================
             PUBMED
          ============================================================ */
          if (domain.includes('ncbi.nlm.nih.gov')) {
            const idMatch = url.match(/\/(\d+)\/?/);
            if (idMatch) {
              const apiUrl =
                `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idMatch[1]}&retmode=json`;
              const r = await fetch(apiUrl);
              if (r.ok) {
                const j = await r.json();
                const item = j.result[idMatch[1]];
                if (item) {
                  const authors = item.authors?.map(a => a.name).join(', ') || '';
                  return {
                    url,
                    status: 'ok',
                    title: item.title,
                    meta: { author: authors, date: item.pubdate || '', site: 'PubMed' },
                    content: `Title: ${item.title}. Author: ${authors}. Date: ${item.pubdate}. Source: PubMed.`
                  };
                }
              }
            }
          }

          /* ============================================================
             DOI / CROSSREF
          ============================================================ */
          const doiMatch = url.match(/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
          if (doiMatch) {
            const r = await fetch(`https://api.crossref.org/works/${doiMatch[1]}`);
            if (r.ok) {
              const j = await r.json();
              const m = j.message;
              const authors = m.author?.map(a => `${a.given} ${a.family}`).join(', ') || '';
              const date = m.published?.['date-parts']?.[0]?.join('-') || '';
              return {
                url,
                status: 'ok',
                title: m.title?.[0] || '',
                meta: { author: authors, date, site: m['container-title']?.[0] || 'Journal' },
                content: `Title: ${m.title?.[0]}. Author: ${authors}. Date: ${date}.`
              };
            }
          }

          /* ============================================================
             HEAD REQUEST (FAST FAIL)
          ============================================================ */
          try {
            const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
            if (head.ok) {
              const date = head.headers.get('last-modified');
              if (date) {
                return {
                  url,
                  status: 'ok',
                  title: '',
                  meta: { author: '', date, site: '' },
                  content: `Source URL: ${url}. Date: ${date}.`
                };
              }
            }
          } catch {}

          /* ============================================================
             HTML FETCH (HEAD-FIRST)
          ============================================================ */
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 6000);

          const response = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'text/html' },
            redirect: 'follow',
            signal: controller.signal
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const ct = response.headers.get('content-type') || '';
          if (!ct.includes('text/html')) throw new Error('Non-HTML');

          const reader = response.body.getReader();
          let html = '';
          while (html.length < 12000) {
            const { done, value } = await reader.read();
            if (done) break;
            html += new TextDecoder().decode(value);
            if (html.includes('</head>')) break;
          }

          if (html.includes('cf-browser-verification') || html.includes('Attention Required')) {
            throw new Error('Bot protection');
          }

          const $ = cheerio.load(html);

          let title =
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="citation_title"]').attr('content') ||
            $('title').text().trim();

          let author =
            $('meta[name="citation_author"]').attr('content') ||
            $('meta[name="author"]').attr('content') ||
            '';

          let date =
            $('meta[name="citation_publication_date"]').attr('content') ||
            $('meta[property="article:published_time"]').attr('content') ||
            '';

          let site =
            $('meta[property="og:site_name"]').attr('content') || '';

          $('script[type="application/ld+json"]').each((_, el) => {
            try {
              const json = JSON.parse($(el).text());
              const objs = json['@graph'] || [json];
              const art = objs.find(o =>
                ['Article', 'NewsArticle', 'BlogPosting', 'Report'].includes(o['@type'])
              );
              if (art) {
                if (!author && art.author)
                  author = Array.isArray(art.author)
                    ? art.author.map(a => a.name).join(', ')
                    : art.author.name;
                if (!date) date = art.datePublished || '';
                if (!site && art.publisher) site = art.publisher.name || '';
              }
            } catch {}
          });

          /* ============================================================
             FULL SCRAPE (LAST RESORT, 1000 CHAR LIMIT)
          ============================================================ */
          let bodyText = '';
          if (!author && !date) {
            const fullHtml = html + (await response.text());
            const $$ = cheerio.load(fullHtml);
            $$('script, style, nav, footer, noscript').remove();
            bodyText = $$('body').text().replace(/\s+/g, ' ').trim().slice(0, 1000);
          }

          let content = `Title: ${title}. `;
          if (author) content += `Author: ${author}. `;
          if (date) content += `Date: ${date}. `;
          if (site) content += `Source: ${site}. `;
          if (bodyText) content += `\n\n${bodyText}`;

          return {
            url,
            status: 'ok',
            title: title || '',
            meta: { author: author || '', date: date || '', site: site || '' },
            content
          };

        } catch (e) {
          return { url, status: 'failed', error: e.message };
        }
      })
    );

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
