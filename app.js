// ============================
// State & Config
// ============================
const config = {
    key: localStorage.getItem('ai-key') || '',
    url: localStorage.getItem('ai-url') || 'https://api.openai.com/v1',
    model: localStorage.getItem('ai-model') || 'gpt-4o-mini'
};

let processing = false;
let timerRef = null;

// DOM
const $ = id => document.getElementById(id);
const chatMessages = $('chat-messages');
const input = $('input');
const sendBtn = $('send-btn');
const chatForm = $('chat-form');
const pipeline = $('pipeline');
const badge = $('status-badge');
const timer = $('timer');
const modal = $('modal');

// ============================
// Events
// ============================
chatForm.addEventListener('submit', e => { e.preventDefault(); send(); });
input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
});
input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$('api-btn').addEventListener('click', () => {
    $('key-input').value = config.key;
    $('url-input').value = config.url;
    $('model-input').value = config.model;
    modal.classList.remove('hidden');
});

// Clear chat
$('clear-btn').addEventListener('click', () => {
    if (!confirm('Clear all chat history?')) return;
    chatMessages.innerHTML = '';
    localStorage.removeItem('chat-history');
    pipeline.innerHTML = '<div class="empty-state"><p>Send a message to see how the AI processes it</p></div>';
    setBadge('idle');
    timer.textContent = '';
});

// Theme toggle
$('theme-btn').addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
});

function updateThemeIcon(isLight) {
    $('theme-icon-moon').style.display = isLight ? 'none' : 'block';
    $('theme-icon-sun').style.display = isLight ? 'block' : 'none';
}

// Load saved theme
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light');
    updateThemeIcon(true);
}
$('modal-save').addEventListener('click', () => {
    config.key = $('key-input').value.trim();
    config.url = $('url-input').value.trim() || 'https://api.openai.com/v1';
    config.model = $('model-input').value;
    localStorage.setItem('ai-key', config.key);
    localStorage.setItem('ai-url', config.url);
    localStorage.setItem('ai-model', config.model);
    modal.classList.add('hidden');
});
$('modal-cancel').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

// ============================
// Main Send Flow
// ============================
async function send() {
    const text = input.value.trim();
    if (!text || processing) return;
    if (!config.key) { alert('Please set your API key first (click the key icon).'); return; }

    processing = true;
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    addMsg(text, 'user');
    setBadge('running');
    startTimer();
    pipeline.innerHTML = '';

    try {
        // Step 1: Show raw input
        await showStep1(text);

        // Step 2: Tokenize & show
        await showStep2(text);

        // Step 3: Use AI to analyze semantics & reasoning
        const analysis = await showStep3(text);

        // Step 4: Show neural network processing
        await showStep4();

        // Step 5: Get actual AI response + show word probabilities
        const response = await showStep5(text);

        // Step 6: Type out response slowly
        await showStep6(response);

        // Add response to chat
        addMsg(response, 'ai');

    } catch (err) {
        addMsg(`Error: ${err.message}`, 'ai');
    }

    setBadge('done');
    stopTimer();
    processing = false;
}

// ============================
// Step 1: Raw Input
// ============================
async function showStep1(text) {
    const step = createStep(1, 'Input Received', 'preprocessing', 'real');
    step.body.innerHTML = `
        <div class="stage-disclaimer">This is real observable data — your raw input as received by the API endpoint.</div>
        <div>Your raw message:</div>
        <div class="reasoning-block">${esc(text)}</div>
        <div style="margin-top:8px;color:var(--text-3)">Characters: ${text.length} | Words: ${text.split(/\s+/).length} | Encoding: UTF-8</div>
    `;
    await appear(step, 1000);
    done(step);
    addConnector();
}

// ============================
// Step 2: Tokenization
// ============================
async function showStep2(text) {
    const step = createStep(2, 'Tokenization (BPE) — Simulated', 'processing', 'illustrative');
    step.body.innerHTML = `
        <div class="stage-disclaimer">Token splits shown are approximate. Real BPE merges are learned statistically and may differ. Token IDs are illustrative, not actual vocabulary indices.</div>
        <div>Splitting into subword tokens using Byte-Pair Encoding:</div>
        <div class="tokens" id="tok-list"></div>
    `;
    await appear(step, 500);

    const tokens = tokenize(text);
    const list = $('tok-list');

    for (const tok of tokens) {
        const el = document.createElement('span');
        el.className = 'tok';
        el.innerHTML = `${esc(tok.t)}<span class="tok-id">${tok.id}</span>`;
        list.appendChild(el);
        await wait(200);
        el.classList.add('show');
        scrollPipeline();
    }

    const info = document.createElement('div');
    info.style.cssText = 'margin-top:10px;color:var(--text-3);font-size:11px;';
    info.textContent = `~${tokens.length} tokens (approximate) | Vocab size: 100,277 (cl100k_base)`;
    step.body.appendChild(info);

    await wait(800);
    done(step);
    addConnector();
}

// ============================
// Step 3: Interpretive Analysis (Educational — AI-Narrated)
// ============================
async function showStep3(text) {
    const step = createStep(3, 'Interpretive Analysis (Model-Narrated)', 'processing', 'educational');
    step.body.innerHTML = `
        <div class="stage-disclaimer">⚠️ This is NOT the model's actual internal reasoning. Real LLMs do not have a separate "understanding" step — comprehension and generation happen simultaneously in the forward pass. This is a separate AI call asking the model to narrate how it <em>might</em> interpret your input, for educational purposes.</div>
        <div>Asking the model to explain how it would interpret this input:</div>
        <div class="reasoning-block" id="reasoning-out" style="margin-top:8px;min-height:60px;color:var(--text-3)">Generating explanation...</div>
    `;
    await appear(step, 600);

    // Detect if input is messy (typos, mixed language, slang)
    const messiness = detectMessyInput(text);

    let analysisPrompt;
    if (messiness.isMessy) {
        analysisPrompt = `You are a teacher explaining to a student how a large language model MIGHT interpret messy or imperfect input. You are NOT describing your actual internal hidden states — you are providing an educational narration of likely interpretation patterns.

The user typed: "${text}"

Detected surface-level issues: ${messiness.reasons.join(', ')}

Respond with a short educational explanation (max 180 words) covering:
1. INTERPRETATION: What you think they likely mean. Show reasoning for each unclear/misspelled/slang word (e.g. "hrasing" → likely "phrasing", "u" → "you")
2. LANGUAGE DETECTION: If mixed languages or non-English, identify them
3. CONTEXT RECOVERY: How surrounding words help a model infer correct meaning despite misspellings (pattern matching from training data, not explicit rules)
4. LIKELY INTENT: What the user is probably trying to say/do
5. CONFIDENCE: How certain this interpretation is (high/medium/low)

Important: Frame this as "a model trained on text would likely..." not "I am internally doing X." Be educational and honest about the limits of this narration.`;
    } else {
        analysisPrompt = `You are a teacher explaining to a student how a large language model MIGHT process this input. You are NOT revealing actual internal hidden states — you are providing an educational narration based on public knowledge of how transformers work.

Given this user message: "${text}"

Respond with a short educational explanation (max 150 words) covering:
1. KEY TOKENS: Which words/phrases carry the most semantic weight and why
2. LIKELY INTENT: What the user is trying to do (question, command, statement, etc)
3. CONTEXT & ASSUMPTIONS: Implicit meaning, tone, or background knowledge needed
4. RESPONSE STRATEGY: How a model would likely approach generating a reply

Important: Frame this as "a transformer model would likely..." not "I am internally doing X." This is educational narration, not introspection into hidden states.`;
    }

    const analysis = await callAPI(analysisPrompt);
    const out = $('reasoning-out');
    out.style.color = 'var(--text)';
    out.textContent = '';

    // Type it out slowly
    for (const char of analysis) {
        out.textContent += char;
        if (char === '.' || char === '\n') await wait(80);
        else await wait(20);
        scrollPipeline();
    }

    await wait(1000);
    done(step);
    addConnector();
    return analysis;
}

// ============================
// Messy Input Detection
// ============================
function detectMessyInput(text) {
    const reasons = [];

    // Check for likely typos (unusual letter combos, no vowels in long words)
    const words = text.split(/\s+/);
    const suspectWords = words.filter(w => {
        if (w.length < 4) return false;
        const lower = w.toLowerCase().replace(/[^a-z]/g, '');
        if (!lower) return false;
        // No vowels in 4+ letter word
        if (lower.length >= 4 && !/[aeiou]/.test(lower)) return true;
        // Double consonant clusters that are unusual
        if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lower)) return true;
        return false;
    });
    if (suspectWords.length > 0) reasons.push(`possible typos: "${suspectWords.slice(0, 3).join('", "')}"`);

    // Check for textspeak/slang (u, ur, r, pls, thx, etc)
    const slang = words.filter(w => /^(u|ur|r|pls|thx|idk|nvm|bruh|lol|omg|wtf|smh|tbh|imo|rn|bc|w\/o)$/i.test(w));
    if (slang.length > 0) reasons.push(`internet slang/abbreviations: "${slang.join('", "')}"`);

    // Check for non-ASCII (other languages)
    if (/[^\x00-\x7F]/.test(text)) reasons.push('non-English characters detected (possible mixed language)');

    // Check for missing spaces (words jammed together)
    const longWords = words.filter(w => w.length > 15);
    if (longWords.length > 0) reasons.push('unusually long tokens (possible missing spaces)');

    // Check for mostly lowercase with no punctuation (casual/messy typing)
    if (text.length > 20 && text === text.toLowerCase() && !/[.!?]/.test(text)) {
        reasons.push('no capitalization or punctuation (very casual input)');
    }

    return { isMessy: reasons.length > 0, reasons };
}

// ============================
// Step 4: Transformer Architecture (Illustrative)
// ============================
async function showStep4() {
    const step = createStep(4, 'Transformer Architecture (Illustrative)', 'processing', 'illustrative');
    step.body.innerHTML = `
        <div class="stage-disclaimer">This is a simplified illustration of transformer layer operations. Exact layer counts and head configurations are not publicly confirmed for proprietary models. Real processing happens in parallel across all tokens simultaneously, not sequentially as shown here.</div>
        <div>Illustrative forward pass through transformer layers:</div>
        <div id="nn-progress" style="margin-top:10px;"></div>
    `;
    await appear(step, 500);

    const prog = $('nn-progress');
    const layers = [
        'Multi-Head Self-Attention (e.g. 32–128 heads)',
        'Layer Normalization + Residual Connection',
        'Feed-Forward Network (4× hidden expansion)',
        'Layer Normalization + Residual Connection',
        'Repeated across N layers (e.g. 32–96+)',
        'Final Layer Normalization',
        'Linear projection → vocabulary logits'
    ];

    for (const layer of layers) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:4px 0;font:11px var(--mono);color:var(--text-3);opacity:0;transition:opacity .3s;';
        row.textContent = `→ ${layer}`;
        prog.appendChild(row);
        await wait(600);
        row.style.opacity = '1';
        row.style.color = 'var(--green)';
        scrollPipeline();
    }

    await wait(800);
    done(step);
    addConnector();
}

// ============================
// Step 5: Response Generation + Real Logprobs
// ============================
async function showStep5(text) {
    const step = createStep(5, 'Token Probabilities (API Logprobs)', 'processing', 'real');
    step.body.innerHTML = `
        <div class="stage-disclaimer">✅ These are REAL probability values returned by the API's logprobs feature — actual model output, not simulated. Each probability reflects the model's computed likelihood for that token given all preceding context.</div>
        <div>Real token probabilities from the model's softmax output:</div>
        <div id="prob-area" style="margin-top:10px;"></div>
    `;
    await appear(step, 500);

    // Get real response WITH logprobs
    const result = await callAPIWithLogprobs(text);
    const response = result.text;
    const logprobs = result.logprobs || [];

    const probArea = $('prob-area');
    const showCount = Math.min(8, logprobs.length);

    for (let i = 0; i < showCount; i++) {
        const tokenData = logprobs[i];
        const group = document.createElement('div');
        group.style.cssText = 'margin-bottom:14px;';

        const label = document.createElement('div');
        label.style.cssText = 'font:10px var(--mono);color:var(--text-3);margin-bottom:5px;';
        label.textContent = `Token ${i + 1} — model selected "${tokenData.token.replace(/^\s/, '⎵')}"`;
        group.appendChild(label);

        // Build rows from real top_logprobs
        const allCandidates = tokenData.top.map((t, idx) => ({
            w: t.token.replace(/^\s/, '⎵'),
            p: t.prob,
            logprob: t.logprob,
            isChosen: idx === 0
        }));

        for (const cand of allCandidates) {
            const row = document.createElement('div');
            row.className = 'prob-row';
            const displayProb = Math.min(cand.p, 99.9);
            row.innerHTML = `
                <div class="prob-word" title="logprob: ${cand.logprob.toFixed(3)}">${esc(cand.w)}</div>
                <div class="prob-bar-bg"><div class="prob-bar-fill ${cand.isChosen ? 'top' : 'other'}"></div></div>
                <div class="prob-pct">${displayProb.toFixed(1)}%</div>
            `;
            group.appendChild(row);
        }

        probArea.appendChild(group);
        await wait(400);

        // Animate bars
        const rows = group.querySelectorAll('.prob-row');
        for (const row of rows) {
            row.classList.add('show');
            const fill = row.querySelector('.prob-bar-fill');
            const pct = parseFloat(row.querySelector('.prob-pct').textContent);
            await wait(120);
            fill.style.width = Math.min(pct, 100) + '%';
        }
        await wait(500);
        scrollPipeline();
    }

    // Disclaimer
    const disclaimer = document.createElement('div');
    disclaimer.style.cssText = 'margin-top:14px;padding:8px 12px;background:var(--bg-1);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text-3);line-height:1.5;';
    disclaimer.textContent = `✅ REAL DATA: These are actual probability values (logprobs) from the model's API response — not simulated or approximated. Showing first ${showCount} of ${logprobs.length} total tokens. The "⎵" symbol represents a leading space (tokens include whitespace). Probabilities are post-temperature (temp=0.7) — the model's raw confidence before temperature scaling may differ. Each token was selected from a vocabulary of 100,277 possible tokens.`;
    probArea.appendChild(disclaimer);

    await wait(800);
    done(step);
    addConnector();
    return response;
}

// ============================
// Step 6: Output Assembly
// ============================
async function showStep6(response) {
    const step = createStep(6, 'Response Assembly', 'processing', 'display-only');
    step.body.innerHTML = `
        <div class="stage-disclaimer">The word-by-word animation is for readability only. Real detokenization is instantaneous — tokens are mapped back to text in a single pass.</div>
        <div>Detokenizing and displaying final response:</div>
        <div class="output-text" id="final-out"><span class="cursor"></span></div>
    `;
    await appear(step, 500);

    const out = $('final-out');
    const words = response.split(' ');

    for (let i = 0; i < words.length; i++) {
        const span = document.createElement('span');
        span.className = 'out-word';
        span.textContent = (i > 0 ? ' ' : '') + words[i];
        out.insertBefore(span, out.querySelector('.cursor'));
        await wait(60 + Math.random() * 40);
        span.classList.add('show');
        scrollPipeline();
    }

    await wait(400);
    const cursor = out.querySelector('.cursor');
    if (cursor) cursor.remove();

    await wait(600);
    done(step);
}

// ============================
// API Call (standard)
// ============================
async function callAPI(prompt) {
    const res = await fetch(`${config.url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: 'You are a helpful assistant. Keep responses concise (under 80 words).' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 200,
            temperature: 0.7
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API returned ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content.trim();
}

// ============================
// API Call with Logprobs (for real token probabilities)
// ============================
async function callAPIWithLogprobs(message) {
    const res = await fetch(`${config.url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: 'You are a helpful assistant. Keep responses concise (under 80 words).' },
                { role: 'user', content: message }
            ],
            max_tokens: 200,
            temperature: 0.7,
            logprobs: true,
            top_logprobs: 5
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API returned ${res.status}`);
    }
    const data = await res.json();
    const choice = data.choices[0];
    const text = choice.message.content.trim();

    // Parse logprobs into clean format
    const logprobs = [];
    if (choice.logprobs && choice.logprobs.content) {
        for (const tokenInfo of choice.logprobs.content) {
            const top = [];
            // The chosen token
            top.push({
                token: tokenInfo.token,
                logprob: tokenInfo.logprob,
                prob: Math.exp(tokenInfo.logprob) * 100
            });
            // Alternative tokens
            if (tokenInfo.top_logprobs) {
                for (const alt of tokenInfo.top_logprobs) {
                    if (alt.token !== tokenInfo.token) {
                        top.push({
                            token: alt.token,
                            logprob: alt.logprob,
                            prob: Math.exp(alt.logprob) * 100
                        });
                    }
                }
            }
            // Sort by probability descending
            top.sort((a, b) => b.prob - a.prob);
            logprobs.push({ token: tokenInfo.token, top });
        }
    }

    return { text, logprobs };
}

// ============================
// Tokenizer (Simulated BPE)
// ============================
function tokenize(text) {
    const common = new Set(['the','is','are','was','were','have','has','had','will','would','could','should','can','do','did','not','and','but','or','if','for','with','from','this','that','what','how','why','when','where','who','hello','hi','hey','you','your','my','me','we','they','it','a','an','to','in','on','at','of','i','be','so','no','yes']);
    const words = text.match(/[\w']+|[^\w\s]/g) || [];
    const tokens = [];
    let id = 2400 + Math.floor(Math.random() * 3000);

    for (const w of words) {
        const lower = w.toLowerCase();
        if (common.has(lower) || w.length <= 3) {
            tokens.push({ t: w, id: id++ });
        } else if (w.length <= 6) {
            tokens.push({ t: w.slice(0, 3), id: id++ });
            tokens.push({ t: '##' + w.slice(3), id: id++ });
        } else {
            tokens.push({ t: w.slice(0, 4), id: id++ });
            tokens.push({ t: '##' + w.slice(4), id: id++ });
        }
    }
    return tokens;
}

// ============================
// Chat Persistence
// ============================
function saveChat() {
    const msgs = [];
    chatMessages.querySelectorAll('.msg').forEach(el => {
        const role = el.classList.contains('user-msg') ? 'user' : 'ai';
        const text = el.querySelector('.msg-text').textContent;
        msgs.push({ role, text });
    });
    localStorage.setItem('chat-history', JSON.stringify(msgs));
}

function loadChat() {
    const saved = localStorage.getItem('chat-history');
    if (!saved) return;
    try {
        const msgs = JSON.parse(saved);
        if (msgs.length === 0) return;
        chatMessages.innerHTML = '';
        msgs.forEach(m => addMsg(m.text, m.role, true));
    } catch (e) {}
}

// Load on startup
loadChat();

// ============================
// Resizable Panels
// ============================
const resizer = $('resizer');
const app = document.querySelector('.app');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const appRect = app.getBoundingClientRect();
    let newLeft = e.clientX - appRect.left;
    // Clamp between 250px and 70% of screen
    newLeft = Math.max(250, Math.min(newLeft, appRect.width * 0.7));
    app.style.gridTemplateColumns = `${newLeft}px 6px 1fr`;
    localStorage.setItem('panel-width', newLeft);
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

// Restore saved panel width
const savedWidth = localStorage.getItem('panel-width');
if (savedWidth) {
    app.style.gridTemplateColumns = `${savedWidth}px 6px 1fr`;
}

// ============================
// UI Helpers
// ============================
function createStep(num, title, status, accuracy) {
    const div = document.createElement('div');
    div.className = 'step';
    const badgeClass = accuracy || 'real';
    const badgeLabels = {
        'real': 'REAL',
        'educational': 'EDUCATIONAL',
        'illustrative': 'ILLUSTRATIVE',
        'display-only': 'DISPLAY'
    };
    div.innerHTML = `
        <div class="step-head">
            <div class="step-num">${num}</div>
            <div class="step-title">${title}</div>
            <span class="accuracy-badge ${badgeClass}">${badgeLabels[badgeClass]}</span>
            <div class="step-tag">${status}</div>
        </div>
        <div class="step-body"></div>
    `;
    pipeline.appendChild(div);
    const body = div.querySelector('.step-body');
    return { el: div, body, tag: div.querySelector('.step-tag') };
}

async function appear(step, delay_ms) {
    await wait(200);
    step.el.classList.add('show', 'active');
    scrollPipeline();
    await wait(delay_ms);
}

function done(step) {
    step.el.classList.remove('active');
    step.el.classList.add('done');
    step.tag.textContent = '✓ done';
}

function addConnector() {
    const c = document.createElement('div');
    c.className = 'connector';
    c.textContent = '↓';
    pipeline.appendChild(c);
    setTimeout(() => c.classList.add('show'), 100);
    scrollPipeline();
}

function scrollPipeline() {
    pipeline.scrollTop = pipeline.scrollHeight;
}

function scrollChat() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addMsg(text, role, skipSave) {
    const div = document.createElement('div');
    div.className = `msg ${role}-msg`;
    div.innerHTML = `<div class="msg-icon">${role === 'user' ? 'You' : 'AI'}</div><div class="msg-text">${esc(text)}</div>`;
    chatMessages.appendChild(div);
    scrollChat();
    if (!skipSave) saveChat();
}

function setBadge(state) {
    badge.className = `badge ${state}`;
    badge.textContent = state.toUpperCase();
}

function startTimer() {
    const start = Date.now();
    timerRef = setInterval(() => {
        timer.textContent = ((Date.now() - start) / 1000).toFixed(1) + 's';
    }, 100);
}

function stopTimer() { clearInterval(timerRef); }

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
