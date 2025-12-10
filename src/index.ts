import { Hono } from 'hono'
import { Ai } from '@cloudflare/ai'
import * as cheerio from 'cheerio'
import Stripe from 'stripe'

type Bindings = {
  AI: any
  DB: D1Database
  STRIPE_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// --- CORS MIDDLEWARE FIX ---
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': c.req.header('Access-Control-Request-Headers') || 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
  }

  const response = await next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
});

// 🏭 管理ダッシュボード（HTML内蔵）
const FACTORY_DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 メタ工場 God Mode ダッシュボード</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="p-4 md:p-8 bg-gray-100 font-sans">
    <div class="max-w-6xl mx-auto bg-white shadow-xl rounded-xl p-6 mb-8">
        <h1 class="text-3xl font-extrabold text-gray-900 mb-2">🏭 メタ工場 God Mode</h1>
        <p class="text-sm text-gray-500 mb-6">Current: <span id="factory-url" class="font-mono bg-gray-200 p-1 rounded">...</span></p>
        <div class="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <h2 class="text-lg font-bold text-yellow-800 mb-2">🔍 手動スキャン</h2>
            <div class="flex gap-2">
                <input type="url" id="scan-url" placeholder="競合URL (例: https://example.com)" class="flex-grow p-2 border rounded">
                <button onclick="triggerScan()" id="scan-button" class="bg-blue-600 text-white font-bold py-2 px-6 rounded hover:bg-blue-700">スキャン</button>
            </div>
            <p id="scan-message" class="mt-2 text-sm text-gray-600"></p>
        </div>
    </div>

    <div class="max-w-6xl mx-auto bg-white shadow-xl rounded-xl p-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-4">🧠 アイデア一覧</h2>
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">競合/URL</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">弱点</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">状態</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    </tr>
                </thead>
                <tbody id="ideas-table-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
        </div>
    </div>

    <script>
        const BASE_URL = window.location.origin;
        document.getElementById('factory-url').textContent = BASE_URL;

        async function fetchIdeas() {
            const tbody = document.getElementById('ideas-table-body');
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Loading...</td></tr>';
            try {
                const res = await fetch(\`\${BASE_URL}/ideas\`);
                if (!res.ok) throw new Error(res.statusText);
                const ideas = await res.json();
                renderTable(ideas);
            } catch (e) {
                tbody.innerHTML = \`<tr><td colspan="5" class="p-4 text-center text-red-500">Error: \${e.message}</td></tr>\`;
            }
        }

        function renderTable(ideas) {
            const tbody = document.getElementById('ideas-table-body');
            tbody.innerHTML = '';
            if (ideas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">データなし</td></tr>';
                return;
            }
            ideas.forEach(idea => {
                const weaknesses = JSON.parse(idea.weaknesses || '[]');
                const hasLP = !!idea.lp_html;
                const row = \`
                    <tr>
                        <td class="px-3 py-3 text-sm">\${idea.id}</td>
                        <td class="px-3 py-3 text-sm">
                            <div class="font-bold">\${idea.competitor_name}</div>
                            <div class="text-xs text-blue-500 truncate w-32">\${idea.url}</div>
                        </td>
                        <td class="px-3 py-3 text-xs text-gray-600">
                            <ul class="list-disc pl-4">\${weaknesses.map(w => \`<li>\${w}</li>\`).join('')}</ul>
                        </td>
                        <td class="px-3 py-3 text-sm">
                            <span class="px-2 py-1 rounded text-xs \${hasLP ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                \${hasLP ? '公開中' : '未生成'}
                            </span>
                        </td>
                        <td class="px-3 py-3 text-sm">
                            \${hasLP 
                                ? \`<a href="\${BASE_URL}/view/\${idea.id}" target="_blank" class="text-blue-600 hover:underline">表示</a>\`
                                : \`<button onclick="generateLp(\${idea.id})" class="text-white bg-green-500 px-2 py-1 rounded text-xs hover:bg-green-600">生成</button>\`
                            }
                        </td>
                    </tr>
                \`;
                tbody.insertAdjacentHTML('beforeend', row);
            });
        }

        async function generateLp(id) {
            if(!confirm('LPを生成しますか？')) return;
            try {
                alert('生成を開始しました。完了までお待ちください...');
                const res = await fetch(\`\${BASE_URL}/generate-lp?id=\${id}\`);
                const data = await res.json();
                if(res.ok) { alert('完了！'); fetchIdeas(); }
                else { alert('失敗: ' + (data.error || 'Unknown')); }
            } catch(e) { alert('エラー: ' + e.message); }
        }

        async function triggerScan() {
            const url = document.getElementById('scan-url').value;
            if(!url) return alert('URLを入力してください');
            document.getElementById('scan-message').textContent = '分析中...';
            try {
                const res = await fetch(\`\${BASE_URL}/scan?url=\${encodeURIComponent(url)}\`);
                const data = await res.json();
                if(res.ok) {
                    document.getElementById('scan-message').textContent = '完了！';
                    fetchIdeas();
                } else {
                    document.getElementById('scan-message').textContent = '失敗: ' + data.error;
                }
            } catch(e) {
                document.getElementById('scan-message').textContent = 'エラー: ' + e.message;
            }
        }

        window.onload = fetchIdeas;
    </script>
</body>
</html>
`;

// === API ROUTES ===

app.get('/', (c) => c.html(FACTORY_DASHBOARD_HTML));

app.get('/scan', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'URL required' }, 400)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, noscript').remove()
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000)
    const ai = new Ai(c.env.AI)
    const messages = [
      { role: 'system', content: 'Identify competitor name and 3 weaknesses. Output valid JSON: { "competitor_name": "Name", "weaknesses": ["Point 1", "Point 2", "Point 3"] }' },
      { role: 'user', content: `URL: ${url}\nContent: ${text}` }
    ]
    const aiRes: any = await ai.run('@cf/meta/llama-3-8b-instruct', { messages })
    let cleanJson = aiRes.response
    if (cleanJson.includes('```')) cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim()
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    const data = JSON.parse(jsonMatch[0])
    await c.env.DB.prepare('INSERT INTO ideas (url, competitor_name, weaknesses) VALUES (?, ?, ?)')
      .bind(url, data.competitor_name, JSON.stringify(data.weaknesses)).run()
    const result: any = await c.env.DB.prepare('SELECT last_insert_rowid() as id').first();
    return c.json({ message: 'Saved!', data, newId: result?.id })
  } catch (e: any) { return c.json({ error: 'Scan failed', details: e.message }, 500) }
})

app.get('/generate-lp', async (c) => {
  const id = c.req.query('id')
  if (!id) return c.json({ error: 'ID required' }, 400)
  const idea: any = await c.env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first()
  if (!idea) return c.json({ error: 'Not found' }, 404)
  
  const weaknesses = JSON.parse(idea.weaknesses).join(', ')
  const competitor = idea.competitor_name
  const productName = `Anti-${competitor} Tool`

  let paymentUrl = '#'
  try {
    const stripe = new Stripe(c.env.STRIPE_API_KEY)
    const product = await stripe.products.create({ name: productName })
    const price = await stripe.prices.create({ product: product.id, unit_amount: 2900, currency: 'usd', recurring: { interval: 'month' } })
    const link = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }] })
    paymentUrl = link.url
  } catch (e) { console.error('Stripe error', e) }

  const prompt = `Create a SaaS Landing Page (HTML) using Tailwind CSS for a tool that solves: "${weaknesses}". Competitor: ${competitor}. Price: $29/mo. IMPORTANT: Set all buy buttons href to "#PAYMENT_TARGET#". Return ONLY raw HTML.`
  const ai = new Ai(c.env.AI)
  const aiRes: any = await ai.run('@cf/meta/llama-3-8b-instruct', { messages: [{ role: 'user', content: prompt }] })
  let html = aiRes.response
  if (html.includes('```')) html = html.replace(/```html/g, '').replace(/```/g, '').trim()
  
  const $ = cheerio.load(html)
  $('a, button').each((i, el) => {
      const t = $(el).text().toLowerCase()
      if(t.includes('buy') || t.includes('start') || t.includes('get')) {
          if(el.tagName === 'button') {
              $(el).replaceWith(`<a href="${paymentUrl}" class="${$(el).attr('class')}">${$(el).text()}</a>`)
          } else {
              $(el).attr('href', paymentUrl)
          }
      }
  })
  const finalHtml = $.html().replace(/#PAYMENT_TARGET#/g, paymentUrl)
  
  await c.env.DB.prepare('UPDATE ideas SET lp_html = ? WHERE id = ?').bind(finalHtml, id).run()
  return c.json({ message: 'LP Generated!', payment_url: paymentUrl, view_url: `${new URL(c.req.url).origin}/view/${id}` })
})

app.get('/ideas', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM ideas ORDER BY id DESC').all()
  return c.json(result.results)
})

app.get('/view/:id', async (c) => {
  const id = c.req.param('id')
  const idea: any = await c.env.DB.prepare('SELECT lp_html FROM ideas WHERE id = ?').bind(id).first()
  if (!idea || !idea.lp_html) return c.text('Not generated', 404)
  return c.html(idea.lp_html)
})

app.get('/discover', async (c) => {
    // Discovery logic placeholder
    return c.json({ message: 'Discovery endpoint active' })
})

export default {
    fetch: app.fetch,
    async scheduled(event: any, env: Bindings, ctx: any) {
        // Simple Cron Logic
        const TARGETS = ['https://en.wikipedia.org/wiki/Notion_(app)', 'https://en.wikipedia.org/wiki/Jira'];
        for (const url of TARGETS) {
            try {
                await app.request('/scan?url=' + encodeURIComponent(url), {}, env)
            } catch(e) { console.error(e) }
        }
    }
}
