/* pipeline.js — PDF processing pipeline logic */

// ─── State ──────────────────────────────────────────────────────
let apiKey = localStorage.getItem('docnav_apikey') || '';
let files  = [];
let index  = [];

const DEFAULT_TOPICS = [
  'Housing', 'Environment', 'Transport', 'Health',
  'Education', 'Economy & Fiscal', 'Infrastructure',
  'Social Services', 'Energy', 'Water', 'Justice & Police'
];
let topics = [...DEFAULT_TOPICS];

// ─── Init ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
    setKeyStatus('API key loaded from storage', 'ok');
  }
  renderTags();
  updateIndexStatus();
  updateEstimate();
});

// ─── API Key ─────────────────────────────────────────────────────
function saveKey() {
  apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setKeyStatus('Please enter a key', 'err'); return; }
  localStorage.setItem('docnav_apikey', apiKey);
  setKeyStatus('API key saved', 'ok');
}

function setKeyStatus(msg, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = msg;
  el.className = 'key-status ' + type;
}

// ─── File handling ────────────────────────────────────────────────
function onDragOver(e)  { e.preventDefault(); document.getElementById('dropZone').classList.add('drag'); }
function onDragLeave()  { document.getElementById('dropZone').classList.remove('drag'); }
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  addFiles([...e.dataTransfer.files].filter(f => f.type === 'application/pdf'));
}
function onFileSelect(e) { addFiles([...e.target.files]); e.target.value = ''; }

function addFiles(newFiles) {
  newFiles.forEach(f => { if (!files.find(x => x.name === f.name)) files.push(f); });
  renderFileList();
  updateEstimate();
}

function removeFile(i) { files.splice(i, 1); renderFileList(); updateEstimate(); }

function renderFileList() {
  const el = document.getElementById('fileList');
  if (!files.length) { el.innerHTML = ''; return; }
  el.innerHTML = files.map((f, i) => `
    <div class="file-row">
      <i class="ti ti-file-type-pdf"></i>
      <span class="fname">${f.name}</span>
      <span class="fsize">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
      <button class="rm-btn" onclick="removeFile(${i})" aria-label="Remove ${f.name}">
        <i class="ti ti-x"></i>
      </button>
    </div>
  `).join('');
}

// ─── Taxonomy ─────────────────────────────────────────────────────
function renderTags() {
  document.getElementById('tagWrap').innerHTML = topics.map((t, i) => `
    <span class="tag">${t}
      <button class="tag-rm" onclick="removeTopic(${i})" aria-label="Remove ${t}">×</button>
    </span>
  `).join('');
}

function removeTopic(i) { topics.splice(i, 1); renderTags(); }

function addTag() {
  const inp = document.getElementById('tagInput');
  const v = inp.value.trim();
  if (v && !topics.includes(v)) { topics.push(v); renderTags(); }
  inp.value = '';
  inp.focus();
}

// ─── Estimate ────────────────────────────────────────────────────
function updateEstimate() {
  const maxWords  = parseInt(document.getElementById('chunkSize').value) || 150;
  // rough: 250 words per PDF page, average 100 pages per file
  const estPages  = files.length * 100;
  const estWords  = estPages * 250;
  const estChunks = Math.ceil(estWords / maxWords);
  const estMins   = Math.ceil(estChunks * 1.2 / 60);
  const estCost   = (estChunks * 0.003).toFixed(2);

  document.getElementById('runEstimate').innerHTML = files.length
    ? `~${estChunks} chunks estimated across ${files.length} file(s) — roughly ${estMins} min and ~$${estCost} USD at Sonnet pricing`
    : 'Add PDFs above to see an estimate';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chunkSize').addEventListener('input', updateEstimate);
});

// ─── Logging ──────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const el  = document.getElementById('logEl');
  const now = new Date();
  const ts  = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${escHtml(msg)}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Progress ────────────────────────────────────────────────────
function setProgress(pct, label) {
  document.getElementById('progBar').style.width  = Math.round(pct) + '%';
  document.getElementById('progPct').textContent  = Math.round(pct) + '%';
  if (label) document.getElementById('progLabel').textContent = label;
}

// ─── PDF extraction ───────────────────────────────────────────────
async function extractPages(file) {
  const buf  = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text    = content.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 30) pages.push({ page: i, text });
  }
  return pages;
}

// ─── Chunking ─────────────────────────────────────────────────────
function chunkPages(pages, maxWords) {
  const chunks = [];
  let buf = '', startPage = pages[0]?.page || 1, endPage = startPage;

  for (const p of pages) {
    const words = p.text.split(/\s+/);
    for (let i = 0; i < words.length; ) {
      const space     = maxWords - buf.split(/\s+/).filter(Boolean).length;
      const take      = words.slice(i, i + space);
      buf     += (buf ? ' ' : '') + take.join(' ');
      i       += take.length;
      endPage  = p.page;
      if (buf.split(/\s+/).filter(Boolean).length >= maxWords) {
        chunks.push({ text: buf.trim(), startPage, endPage });
        buf = ''; startPage = p.page;
      }
    }
  }
  if (buf.trim().length > 40) chunks.push({ text: buf.trim(), startPage, endPage });
  return chunks;
}

// ─── Claude API call ──────────────────────────────────────────────
async function classifyChunk(chunk, docName, chunkIdx, totalChunks) {
  const prompt = `You are indexing a document called "${docName}" for semantic search.

Chunk ${chunkIdx + 1} of ${totalChunks} (pages ${chunk.startPage}–${chunk.endPage}):

"""
${chunk.text.slice(0, 1800)}
"""

Available topics: ${topics.join(', ')}

Respond ONLY with a valid JSON object — no markdown fences, no preamble:
{
  "topics": ["1–4 most relevant topics from the list above"],
  "summary": "one sentence describing the key point of this passage",
  "figures": ["key dollar amounts, percentages, counts — max 6, empty array if none"],
  "dates": ["specific dates or year ranges mentioned — empty array if none"],
  "conflict_signal": false
}

Set conflict_signal to true if this passage contains a figure or date that appears to directly contradict another specific value (e.g. two different years for the same project, two different dollar amounts for the same program).`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const raw  = data.content?.find(b => b.type === 'text')?.text || '{}';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { topics: [], summary: raw.slice(0, 120), figures: [], dates: [], conflict_signal: false };
  }
}

// ─── Doc colours (for pill badges) ───────────────────────────────
const DOC_COLORS = [
  { bg: '#E6F1FB', text: '#0C447C' },
  { bg: '#E1F5EE', text: '#085041' },
  { bg: '#FAEEDA', text: '#633806' },
  { bg: '#FAECE7', text: '#712B13' },
  { bg: '#EEEDFE', text: '#3C3489' },
  { bg: '#EAF3DE', text: '#27500A' },
];

// ─── Run pipeline ────────────────────────────────────────────────
async function runPipeline() {
  if (!apiKey)       { alert('Please enter and save your API key first.');     return; }
  if (!files.length) { alert('Please upload at least one PDF.');               return; }
  if (!topics.length){ alert('Please add at least one topic to the taxonomy.'); return; }

  index = [];
  const grid = document.getElementById('chunkGrid');
  grid.innerHTML = '';

  document.getElementById('progressSection').style.display = 'block';
  document.getElementById('statsSection').style.display    = 'none';
  document.getElementById('chunksSection').style.display   = 'none';
  document.getElementById('logEl').innerHTML = '';
  document.getElementById('runBtn').disabled = true;
  setProgress(0, 'Starting…');

  const maxWords   = parseInt(document.getElementById('chunkSize').value)   || 150;
  const rps        = parseInt(document.getElementById('concurrency').value) || 2;
  const delayMs    = Math.round(1000 / rps);

  // ── Phase 1: extract all text ────────────────────────────────
  const allChunks = [];
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    log(`Extracting text from "${f.name}"…`);
    try {
      const pages  = await extractPages(f);
      log(`  → ${pages.length} pages`, 'ok');
      const chunks = chunkPages(pages, maxWords);
      log(`  → ${chunks.length} chunks`, 'ok');
      chunks.forEach((c, ci) => allChunks.push({
        ...c,
        docName:     f.name.replace(/\.pdf$/i, ''),
        docIndex:    fi,
        chunkIndex:  ci,
        totalChunks: chunks.length,
      }));
    } catch (e) {
      log(`  Error: ${e.message}`, 'err');
    }
  }

  log(`Total ${allChunks.length} chunks across ${files.length} file(s) — classifying with Claude…`, 'info');
  document.getElementById('chunksSection').style.display = 'block';

  // ── Phase 2: classify each chunk ────────────────────────────
  for (let i = 0; i < allChunks.length; i++) {
    const c   = allChunks[i];
    const pct = ((i + 1) / allChunks.length) * 100;
    setProgress(pct, `Classifying chunk ${i + 1} / ${allChunks.length} — "${c.docName}" p.${c.startPage}`);
    log(`[${i + 1}/${allChunks.length}] "${c.docName}" p.${c.startPage}–${c.endPage}`);

    try {
      const result = await classifyChunk(c, c.docName, c.chunkIndex, c.totalChunks);
      const entry = {
        id:              `${c.docName.replace(/\W+/g, '_')}_${i}`,
        document:        c.docName,
        docIndex:        c.docIndex,
        pages:           { start: c.startPage, end: c.endPage },
        text:            c.text,
        topics:          result.topics  || [],
        summary:         result.summary || '',
        figures:         result.figures || [],
        dates:           result.dates   || [],
        conflict_signal: !!result.conflict_signal,
      };
      index.push(entry);

      const dc   = DOC_COLORS[c.docIndex % DOC_COLORS.length];
      const card = document.createElement('div');
      card.className = 'chunk-card';
      card.innerHTML = `
        <div class="chunk-header">
          <span class="doc-pill" style="background:${dc.bg};color:${dc.text}">${c.docName}</span>
          <span class="page-ref">p.${c.startPage}${c.startPage !== c.endPage ? '–' + c.endPage : ''}</span>
          ${(result.topics || []).map(t => `<span class="topic-pill">${t}</span>`).join('')}
          ${result.conflict_signal ? `<span class="conflict-pill"><i class="ti ti-alert-triangle" style="font-size:10px"></i> review</span>` : ''}
        </div>
        <div class="chunk-summary">${escHtml(result.summary || '')}</div>
        ${(result.figures || []).length
          ? `<div class="chunk-figures">${result.figures.map(f => `<span class="fig-pill">${escHtml(f)}</span>`).join('')}</div>`
          : ''}
        <div class="chunk-text-preview">${escHtml(c.text.slice(0, 350))}…</div>`;
      grid.appendChild(card);
      grid.scrollTop = grid.scrollHeight;

      log(`  → [${(result.topics || []).join(', ') || 'no topics'}]${result.conflict_signal ? ' ⚠' : ''}`, 'ok');
    } catch (e) {
      log(`  Error: ${e.message}`, 'err');
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  // ── Phase 3: summary ────────────────────────────────────────
  setProgress(100, 'Done');
  log(`Pipeline complete — ${index.length} chunks indexed`, 'ok');

  const uniqueTopics = [...new Set(index.flatMap(c => c.topics))];
  const totalFigs    = index.flatMap(c => c.figures).length;

  document.getElementById('statDocs').textContent   = files.length;
  document.getElementById('statChunks').textContent = index.length;
  document.getElementById('statTopics').textContent = uniqueTopics.length;
  document.getElementById('statFigs').textContent   = totalFigs;
  document.getElementById('statsSection').style.display = 'block';

  document.getElementById('chunkCountLabel').textContent = `(${index.length} — hover to preview text)`;

  // Save to localStorage for the navigator
  localStorage.setItem('docnav_index', JSON.stringify(buildIndexPayload()));
  updateIndexStatus();

  document.getElementById('runBtn').disabled = false;
}

// ─── Build index payload ─────────────────────────────────────────
function buildIndexPayload() {
  return {
    generated: new Date().toISOString(),
    taxonomy:  topics,
    documents: files.map((f, i) => ({ name: f.name.replace(/\.pdf$/i, ''), docIndex: i })),
    chunks:    index,
  };
}

// ─── Download ────────────────────────────────────────────────────
function downloadJSON() {
  const blob = new Blob([JSON.stringify(buildIndexPayload(), null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'document_index.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadIntoNavigator() {
  localStorage.setItem('docnav_index', JSON.stringify(buildIndexPayload()));
  window.location.href = 'navigator.html';
}

// ─── Index status ─────────────────────────────────────────────────
function updateIndexStatus() {
  const raw = localStorage.getItem('docnav_index');
  const el  = document.getElementById('indexStatus');
  if (!el) return;
  if (raw) {
    try {
      const idx = JSON.parse(raw);
      el.textContent = `Index: ${idx.chunks?.length || 0} chunks`;
    } catch { el.textContent = 'Index: error'; }
  } else {
    el.textContent = 'No index loaded';
  }
}