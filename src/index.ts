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
// -------------------------------------------------------------


// 🏭 管理ダッシュボード（HTML内蔵）の定義
const FACTORY_DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 メタ工場 God Mode ダッシュボード</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f3f4f6;
        }
        .scrollable-content {
            max-height: 400px;
            overflow-y: auto;
        }
    </style>
</head>
<body class="p-4 md:p-8">
    
    <!-- 設定 & コントロールパネル -->
    <div class="max-w-6xl mx-auto bg-white shadow-xl rounded-xl p-6 mb-8">
        <h1 class="text-3xl font-extrabold text-gray-900 mb-2 flex items-center">
            <span class="mr-2">🏭</span> メタ工場 God Mode ダッシュボード
        </h1>
        <p class="text-sm text-gray-500 mb-6">現在の工場URL: <span id="factory-url" class="font-mono text-xs bg-gray-100 p-1 rounded"></span></p>

        <!-- 手動スキャンコントロール -->
        <div class="p-4 bg-yellow-50 rounded-lg border border-yellow-200 shadow-inner">
            <h2 class="text-xl font-semibold text-yellow-800 mb-3">🔍 手動ターゲットスキャン</h2>
            <p class="text-sm text-gray-600 mb-3">新しい競合のURLを入力し、即座に弱点分析を行います。</p>
            <div class="flex flex-col md:flex-row gap-3">
                <input type="url" id="scan-url" placeholder="例: https://example.com/competitor-lp" class="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition shadow-sm" required>
                <button onclick="triggerScan()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-200 whitespace-nowrap" id="scan-button">
                    スキャン＆DB保存
                </button>
            </div>
            <p id="scan-message" class="mt-3 text-sm text-gray-700 hidden"></p>
        </div>
    </div>

    <!-- アイデア一覧テーブル -->
    <div class="max-w-6xl mx-auto bg-white shadow-xl rounded-xl p-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-4">🧠 アイデア（資産）一覧</h2>
        
        <div class="overflow-x-auto scrollable-content">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50 sticky top-0">
                    <tr>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">競合/URL</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">弱点（ビジネスチャンス）</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">LPステータス</th>
                        <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">アクション</th>
                    </tr>
                </thead>
                <tbody id="ideas-table-body" class="bg-white divide-y divide-gray-200">
                    <!-- データがここに挿入されます -->
                    <tr>
                        <td colspan="5" class="py-4 text-center text-gray-500">データをロード中です...</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="text-right text-xs text-gray-400 mt-4">最終更新: <span id="last-updated">--</span></p>
    </div>

    <script>
        // ★★★ BASE_URL はデプロイ後に動的に取得されます ★★★
        const BASE_URL = 'https://meta-factory-brain.hekuijincun.workers.dev';
        document.getElementById('factory-url').textContent = BASE_URL;

        // --- データ取得ロジック ---
        async function fetchIdeas() {
            const tableBody = document.getElementById('ideas-table-body');
            tableBody.innerHTML = \`<tr><td colspan="5" class="py-4 text-center text-blue-500">最新データを取得中...</td></tr>\`;
            
            try {
                const response = await fetch(\`\${BASE_URL}/ideas\`); 

                if (!response.ok) {
                    throw new Error(\`API接続エラー (Status: \${response.status})\`);
                }
                
                const ideas = await response.json();
                
                if (ideas && ideas.length > 0) {
                    renderTable(ideas);
                } else {
                    tableBody.innerHTML = \`<tr><td colspan="5" class="py-4 text-center text-gray-500">データがありません。手動スキャンで最初のアイデアを作成してください。</td></tr>\`;
                }

                document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

            } catch (error) {
                console.error('Error fetching ideas:', error);
                tableBody.innerHTML = \`<tr><td colspan="5" class="py-4 text-center text-red-500">
                    ❌ データ取得中にエラーが発生しました。<br>
                    Workerがデプロイされていないか、APIがクラッシュしています。コンソールを確認してください。
                    </td></tr>\`;
            }
        }

        // --- LP生成、スキャン、テーブルレンダリングロジック（簡略化のため前のコードを流用） ---
        
        function renderTable(ideas) {
            const tableBody = document.getElementById('ideas-table-body');
            tableBody.innerHTML = ''; 

            ideas.forEach(idea => {
                const weaknesses = JSON.parse(idea.weaknesses || '[]');
                
                const isLpGenerated = idea.lp_html !== null;
                const statusClass = isLpGenerated ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                const statusText = isLpGenerated ? '✅ 公開準備OK' : '❌ 未生成';

                const row = \`
                    <tr id="row-\${idea.id}">
                        <td class="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">\${idea.id}</td>
                        <td class="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                            <span class="font-semibold text-gray-800">\${idea.competitor_name}</span><br>
                            <span class="text-xs text-blue-500 truncate block">\${idea.url}</span>
                        </td>
                        <td class="px-3 py-3 text-sm text-gray-700 max-w-sm">
                            <ul class="list-disc list-inside text-xs space-y-0.5">
                                \${weaknesses.map(w => \`<li class="truncate">\${w}</li>\`).join('')}
                            </ul>
                        </td>
                        <td class="px-3 py-3 whitespace-nowrap">
                            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${statusClass}">
                                \${statusText}
                            </span>
                        </td>
                        <td class="px-3 py-3 whitespace-nowrap text-sm font-medium space-x-2">
                            \${isLpGenerated 
                                ? \`<a href="\${BASE_URL}/view/\${idea.id}" target="_blank" class="text-indigo-600 hover:text-indigo-900 text-xs font-semibold p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition shadow-sm">LP表示</a>\`
                                : \`<button onclick="generateLp(\${idea.id})" class="text-yellow-700 hover:text-yellow-900 text-xs font-semibold p-2 rounded-lg bg-yellow-100 hover:bg-yellow-200 transition shadow-sm" id="gen-btn-\${idea.id}">LP生成</button>\`
                            }
                        </td>
                    </tr>
                \`;
                tableBody.insertAdjacentHTML('beforeend', row);
            });
        }
        
        async function generateLp(id) {
            const button = document.getElementById(\`gen-btn-\${id}\`);
            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = '生成中...';
            button.classList.add('animate-pulse');

            try {
                const response = await fetch(\`\${BASE_URL}/generate-lp?id=\${id}\`);
                const result = await response.json();

                if (response.ok) {
                    alert(\`LP生成が完了しました！Stripeリンクも自動で埋め込まれました。\`);
                    fetchIdeas();
                } else {
                    alert(\`LP生成に失敗しました: \${result.details || result.error}\`);
                }
            } catch (error) {
                console.error('LP generation error:', error);
                alert('LP生成中に致命的なエラーが発生しました。コンソールを確認してください。');
            } finally {
                button.disabled = false;
                button.textContent = originalText;
                button.classList.remove('animate-pulse');
            }
        }

        async function triggerScan() {
            const urlInput = document.getElementById('scan-url');
            const scanButton = document.getElementById('scan-button');
            const messageDiv = document.getElementById('scan-message');
            const url = urlInput.value;

            if (!url) {
                alert('URLを入力してください。');
                return;
            }

            scanButton.disabled = true;
            scanButton.textContent = '分析中...';
            scanButton.classList.add('animate-pulse');
            messageDiv.classList.remove('hidden', 'text-green-600', 'text-red-600');
            messageDiv.textContent = 'AIが弱点分析中です...';

            try {
                const response = await fetch(\`\${BASE_URL}/scan?url=\${encodeURIComponent(url)}\`);
                const result = await response.json();

                if (response.ok) {
                    messageDiv.textContent = \`✅ 分析が完了し、ID \${result.newId} でDBに保存されました。\`;
                    messageDiv.classList.replace('text-gray-700', 'text-green-600');
                    urlInput.value = '';
                    fetchIdeas();
                } else {
                    alert(\`LP生成に失敗しました: \${result.details || result.error}\`);
                }
            } catch (error) {
                console.error('Scan error:', error);
                messageDiv.textContent = \`❌ ネットワークエラーが発生しました。コンソールを確認してください。\`;
                messageDiv.classList.replace('text-gray-700', 'text-red-600');
            } finally {
                scanButton.disabled = false;
                scanButton.textContent = 'スキャン＆DB保存';
                scanButton.classList.remove('animate-pulse');
            }
        }
        
        window.onload = fetchIdeas;
    </script>
</body>
</html>
`;
const WORKER_MAIN_LOGIC = `
app.get('/', (c) => c.html(FACTORY_DASHBOARD_HTML));

app.get('/scan', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'URL required' }, 400)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, noscript').remove()
    const text = $('body').text().replace(/\\s+/g, ' ').trim().slice(0, 3000)
    const ai = new Ai(c.env.AI)
    const messages = [
      { role: 'system', content: 'Identify competitor name and 3 weaknesses. Output valid JSON: { "competitor_name": "Name", "weaknesses": ["Point 1", "Point 2", "Point 3"] }' },
      { role: 'user', content: \`URL: \${url}\\nContent: \${text}\` }
    ]
    const aiRes: any = await ai.run('@cf/meta/llama-3-8b-instruct', { messages })
    
    let cleanJson = aiRes.response
    if (cleanJson.includes('\`\`\`')) cleanJson = cleanJson.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
    const jsonMatch = cleanJson.match(/\\\{[\\s\\S]*\\\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    const data = JSON.parse(jsonMatch[0])

    await c.env.DB.prepare('INSERT INTO ideas (url, competitor_name, weaknesses) VALUES (?, ?, ?)')
      .bind(url, data.competitor_name, JSON.stringify(data.weaknesses)).run()
      
    const result: any = await c.env.DB.prepare('SELECT last_insert_rowid() as id').first();
    const newId = result?.id;
    
    return c.json({ message: 'Analyzed & Saved! 💾', data, newId })
  } catch (e: any) { return c.json({ error: 'Scan failed', details: e.message }, 500) }
})

app.get('/generate-lp', async (c) => {
  const id = c.req.query('id')
  if (!id) return c.json({ error: 'Idea ID required' }, 400)

  const idea: any = await c.env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first()
  if (!idea) return c.json({ error: 'Idea not found' }, 404)

  const weaknesses = JSON.parse(idea.weaknesses).join(', ')
  const competitor = idea.competitor_name
  const productName = \`Solution for \${competitor} users\`

  // Stripeリンク発行
  let paymentUrl = '#'
  try {
    const stripe = new Stripe(c.env.STRIPE_API_KEY)
    const product = await stripe.products.create({ name: productName })
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2900,
      currency: 'usd',
      recurring: { interval: 'month' },
    })
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
    })
    paymentUrl = paymentLink.url
  } catch (e) {
    console.error('Stripe Error:', e)
  }

  // AIへの命令
  const prompt = \`
    You are a Tailwind CSS Expert.
    Create a modern Landing Page (HTML) for a SaaS that fixes: "\${weaknesses}". Price is $29/mo.
    
    CRITICAL INSTRUCTION: - Use Tailwind CSS CDN. - Set the link for "Buy" buttons to: #PAYMENT_TARGET# - Return ONLY raw HTML.
  \`
  const ai = new Ai(c.env.AI)
  const aiRes: any = await ai.run('@cf/meta/llama-3-8b-instruct', { messages: [{ role: 'user', content: prompt }] })

  let html = aiRes.response
  if (html.includes('\`\`\`')) html = html.replace(/\`\`\`html/g, '').replace(/\`\`\`/g, '').trim()

  // Cheerio強制注入ロジック
  const $ = cheerio.load(html)
  $('a[href="#"], a[href="javascript:void(0)"], a[href=""]').attr('href', paymentUrl)
  const finalHtml = $.html().replace(/#PAYMENT_TARGET#/g, paymentUrl); // 念の為プレースホルダも置換

  await c.env.DB.prepare('UPDATE ideas SET lp_html = ? WHERE id = ?').bind(finalHtml, id).run()

  return c.json({ message: 'LP Generated & Injected! 💉', payment_url: paymentUrl, view_url: \`\${new URL(c.req.url).origin}/view/\${id}\` })
})

app.get('/ideas', async (c) => {
  const result = await c.env.DB.prepare('SELECT id, competitor_name, weaknesses, created_at, lp_html FROM ideas ORDER BY id DESC').all()
  return c.json(result.results)
})

app.get('/view/:id', async (c) => {
  const id = c.req.param('id')
  const idea: any = await c.env.DB.prepare('SELECT lp_html FROM ideas WHERE id = ?').bind(id).first()
  if (!idea || !idea.lp_html) return c.text('LP not generated yet', 404)
  return c.html(idea.lp_html)
})


app.get('/discover', async (c) => {
    const ai = new Ai(c.env.AI)
    const prompt = \`
        You are a top-tier B2B market analyst. Identify 3 new, promising B2B SaaS companies or large software categories (excluding Notion, Jira, Trello).
        The goal is to find companies ripe for disruption in niche markets (e.g., Construction, Logistics, Legal).
        Return only a JSON array of their homepage URLs. Example: ["https://example.com/companyA", "https://example.com/companyB"]
    \`;
    const messages = [{ role: 'user', content: prompt }];
    
    const aiRes: any = await ai.run('@cf/meta/llama-3-8b-instruct', { messages });
    
    // JSON抽出ロジック
    let cleanJson = aiRes.response;
    if (cleanJson.includes('\`\`\`')) cleanJson = cleanJson.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    const jsonMatch = cleanJson.match(/\[\\s\\S]*\]/); // 配列を探す
    
    if (!jsonMatch) return c.json({ error: 'AI failed to generate URL array.' }, 500);

    const urls = JSON.parse(jsonMatch[0]);

    return c.json({ message: 'New targets discovered!', targets: urls });
});


// === スケジュールされた処理の本体（自動巡回） ===
async function handleScheduled(env: Bindings) {
    console.log('--- CRON TRIGGER: AUTO RESEARCH START ---');
    
    const TARGETS = [
        'https://en.wikipedia.org/wiki/Notion_(app)',
        'https://en.wikipedia.org/wiki/Jira',
        'https://en.wikipedia.org/wiki/Trello',
    ];
    
    // 1. 未生成LPの検索と自動生成 (省略)
    const newIdeas: any = await env.DB.prepare(
        "SELECT id FROM ideas WHERE lp_html IS NULL ORDER BY id DESC LIMIT 5"
    ).all();
    
    if (newIdeas.results.length > 0) {
        console.log(\`[CRON] Found \${newIdeas.results.length} ungenerated LPs. Starting generation...\`);
        for (const idea of newIdeas.results) {
            const generateUrl = \`https://meta-factory-brain.hekuijincun.workers.dev/generate-lp?id=\${idea.id}\`;
            try {
                await fetch(generateUrl);
                console.log(\`[CRON] Generated LP for existing ID: \${idea.id}\`);
            } catch (error) {
                console.error(\`[CRON] Failed to generate LP for ID \${idea.id}:\`, error);
            }
        }
    }
    
    // 2. 新しい市場調査（自動巡回）
    console.log('[CRON] Starting market scan...');
    for (const url of TARGETS) {
        const apiUrl = \`https://meta-factory-brain.hekuijincun.workers.dev/scan?url=\${url}\`;
        try {
            await fetch(apiUrl); 
            console.log(\`[CRON] Successfully scanned and saved new idea for: \${url}\`);
        } catch (error) {
            console.error(\`[CRON] Failed to auto-scan \${url}:\`, error);
        }
    }

    console.log('--- CRON TRIGGER: AUTO RESEARCH END ---');
}

// === 最終エクスポート構造（HonoとCronを両立）===
export default {
    fetch: app.fetch, 
    async scheduled(event: any, env: Bindings, ctx: any) {
        ctx.waitUntil(handleScheduled(env));
    },
};