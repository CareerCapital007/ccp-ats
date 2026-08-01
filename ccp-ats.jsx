import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import mammoth from 'mammoth';
import {
  Plus, X, Download, Users, Briefcase, Building2, CalendarClock, FileText,
  Search as SearchIcon, Trash2, Check, AlertCircle, Loader2, Upload, Settings,
  Mail, Phone, Linkedin, ExternalLink, ArrowRight, Circle,
  UploadCloud, Paperclip, RefreshCw, Wand2
} from 'lucide-react';

/* ============================================================
   CAREER CAPITAL PARTNERS - Search Ledger
   Single-file ATS / CRM. Data persists in shared artifact storage.
   ============================================================ */

// Values read off careercapitalpartners.com. `green` keeps its name so every
// existing reference picks up the navy without a rename.
const C = {
  green: '#16233A',
  greenMid: '#28374F',
  greenSoft: '#EAE8E1',
  navy: '#0E1A2B',
  brass: '#A98545',
  brassSoft: '#F1EADC',
  paper: '#F2F0EA',
  card: '#FFFFFF',
  line: '#E0DCD2',
  lineSoft: '#ECE9E1',
  ink: '#16233A',
  mute: '#6B7383',
  red: '#9B3B2E',
  amber: '#B37A1F',
  placed: '#1F6B4A',
};

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "'Jost', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Jost:wght@300;400;500;600;700&display=swap';

const CORE_KEY = 'ccp-ats-core-v1';
const RESUME_PREFIX = 'ccp-resume:';
const CVFILE_PREFIX = 'ccp-cv-file:';
const MAX_CV_BYTES = 2_600_000; // keeps the stored base64 under the 5MB per-record ceiling

const STAGES = [
  { id: 'identified', label: 'Identified', color: '#8B9099' },
  { id: 'outreach', label: 'Outreach', color: '#5B7C99' },
  { id: 'screened', label: 'Screened', color: '#3F6C8A' },
  { id: 'submitted', label: 'Client Submitted', color: '#A98545' },
  { id: 'interview', label: 'Client Interview', color: '#8A6A2E' },
  { id: 'finalist', label: 'Finalist', color: '#28513F' },
  { id: 'offer', label: 'Offer', color: '#173A2D' },
  { id: 'placed', label: 'Placed', color: '#1F6B4A' }, // intentionally green: the only positive terminal state
  { id: 'passed', label: 'Passed', color: '#9B3B2E' },
];
const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
const searchIdsOf = (c) => (c.searchIds && c.searchIds.length ? c.searchIds : c.searchId ? [c.searchId] : []);
const stageFor = (c, sid) => (sid && c.stages && c.stages[sid]) || c.stage || 'identified';
const ROUNDS = ['Screen', 'First round', 'Panel', 'Final', 'Reference'];
const interviewFor = (c, sid) => (sid && c.interviews && c.interviews[sid]) || null;
const nextInterview = (c) => {
  const all = Object.values(c.interviews || {}).filter((i) => i && i.date);
  if (!all.length) return null;
  return all.sort((a, b) => a.date.localeCompare(b.date))[0];
};
const furthestStage = (c) => {
  const ids = searchIdsOf(c);
  if (!ids.length || !c.stages) return c.stage || 'identified';
  const idx = ids.map((id) => STAGES.findIndex((s) => s.id === stageFor(c, id)));
  return STAGES[Math.max(0, ...idx)].id;
};
const ACTIVE_STAGES = ['identified', 'outreach', 'screened', 'submitted', 'interview', 'finalist', 'offer'];

const TAG_COLORS = ['#173A2D', '#A98545', '#3F6C8A', '#7A4A6B', '#8A6A2E', '#2F6B5A', '#9B3B2E', '#4A5568'];

const DEFAULT_TAGS = [
  'Sales', 'AI Engineering', 'Product', 'Strategy & Operations',
  'Engineering', 'Finance', 'Marketing', 'People & Talent', 'Executive / GM',
];

const SEED = {
  candidates: [],
  searches: [],
  clients: [],
  contacts: [],
  meta: { tags: DEFAULT_TAGS, owners: ['Recruiter', 'Joe Carbone'] },
};

/* ---------- helpers ---------- */
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nowISO = () => new Date().toISOString();
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '-';
const startOfWeek = () => {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const tagColor = (tags, t) => TAG_COLORS[Math.max(0, tags.indexOf(t)) % TAG_COLORS.length];

/* ---------- CV reading + parsing ---------- */
const fileToBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('That file could not be read.'));
    r.readAsDataURL(file);
  });

const fileToText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('That file could not be read.'));
    r.readAsText(file);
  });

const kindOf = (file) => {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.txt') || n.endsWith('.md') || file.type === 'text/plain') return 'text';
  if ((file.type || '').startsWith('image/')) return 'image';
  return 'unsupported';
};

const PARSE_FIELDS = `{
  "name": "full name",
  "title": "current job title",
  "company": "current employer",
  "email": "",
  "phone": "",
  "linkedin": "full URL or empty string",
  "location": "city, state or city, country",
  "functionTags": ["only values chosen from the allowed list"],
  "seniority": "one of: Individual Contributor, Manager, Director, VP, C-Level, Board",
  "yearsExperience": "number as a string",
  "compCurrent": "only if the CV states it, otherwise empty string",
  "summary": "two sentences on what this person does and the scale they operate at",
  "highlights": ["up to four short achievement lines with numbers where the CV gives them"],
  "resumeDigest": "a compact plain-text record: each role as Company | Title | Dates on its own line, then a Skills line. No commentary."
}`;

async function parseCV(file, tags) {
  const kind = kindOf(file);
  if (kind === 'unsupported') throw new Error('Unsupported file. Use PDF, DOCX, TXT, or an image.');

  const instruction =
    `You are parsing an executive recruiting CV. Extract the fields below and return ONLY a JSON object, ` +
    `with no preamble, no explanation, and no markdown fences.\n\n` +
    `Allowed values for functionTags (choose every one that genuinely applies, and nothing outside this list): ` +
    `${JSON.stringify(tags)}.\n\n` +
    `Use an empty string for anything the CV does not state. Never invent contact details or employers.\n\n` +
    `Return exactly this shape:\n${PARSE_FIELDS}`;

  let content;
  let localText = '';

  if (kind === 'docx') {
    const buf = await file.arrayBuffer();
    const out = await mammoth.extractRawText({ arrayBuffer: buf });
    localText = (out.value || '').trim();
    if (!localText) throw new Error('No text found in that DOCX.');
    content = [{ type: 'text', text: `${instruction}\n\nCV TEXT:\n${localText.slice(0, 40000)}` }];
  } else if (kind === 'text') {
    localText = (await fileToText(file)).trim();
    content = [{ type: 'text', text: `${instruction}\n\nCV TEXT:\n${localText.slice(0, 40000)}` }];
  } else if (kind === 'pdf') {
    const b64 = await fileToBase64(file);
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: instruction },
    ];
  } else {
    const b64 = await fileToBase64(file);
    content = [
      { type: 'image', source: { type: 'base64', media_type: file.type || 'image/png', data: b64 } },
      { type: 'text', text: instruction },
    ];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('The parser did not respond. Try that file again.');

  const data = await res.json();
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a === -1 || b === -1) throw new Error('The CV could not be read into fields.');
    parsed = JSON.parse(raw.slice(a, b + 1));
  }

  const allowed = new Set(tags);
  parsed.functionTags = (parsed.functionTags || []).filter((t) => allowed.has(t));
  parsed.highlights = (parsed.highlights || []).filter(Boolean);
  parsed.localText = localText;
  return parsed;
}

const buildResumeText = (p) => {
  const parts = [];
  if (p.localText) return p.localText;
  if (p.summary) parts.push(p.summary);
  if (p.highlights?.length) parts.push(p.highlights.map((h) => `- ${h}`).join('\n'));
  if (p.resumeDigest) parts.push(p.resumeDigest);
  return parts.join('\n\n');
};

const packCVFile = async (file) => {
  if (file.size > MAX_CV_BYTES) return null;
  return { name: file.name, type: file.type || 'application/octet-stream', data: await fileToBase64(file) };
};

const downloadCVFile = (rec) => {
  const bin = atob(rec.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: rec.type }));
  a.download = rec.name;
  a.click();
};

/* ---------- small UI atoms ---------- */
function Eyebrow({ children, color = C.brass, rule = true, style }) {
  return (
    <div className="flex items-center gap-2" style={{ ...style }}>
      {rule && <span style={{ display: 'inline-block', width: 22, height: 1, background: color, opacity: 0.75, flexShrink: 0 }} />}
      <span style={{ fontFamily: SANS, fontSize: 9.5, letterSpacing: 2.4, textTransform: 'uppercase', color, fontWeight: 500 }}>
        {children}
      </span>
    </div>
  );
}

function Headline({ children, size = 20, color = C.green, style }) {
  return (
    <div style={{ fontFamily: SERIF, fontSize: size, fontWeight: 600, color, lineHeight: 1.04, letterSpacing: -0.6, ...style }}>
      {children}
    </div>
  );
}

function SectionHead({ eyebrow, title, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.line}` }}>
      <div>
        {eyebrow && <Eyebrow style={{ marginBottom: 5 }}>{eyebrow}</Eyebrow>}
        <Headline size={22}>{title}</Headline>
      </div>
      {action}
    </div>
  );
}

function Pill({ children, color = C.green, filled = false, onClick, title }) {
  return (
    <span
      title={title}
      onClick={onClick}
      className="inline-flex items-center"
      style={{
        fontFamily: SANS,
        fontSize: 9.5,
        letterSpacing: 0.9,
        textTransform: 'uppercase',
        fontWeight: 600,
        padding: '2px 8px',
        color: filled ? '#fff' : color,
        background: filled ? color : `${color}14`,
        border: `1px solid ${color}33`,
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Field({ label, children, span }) {
  return (
    <label className="flex flex-col gap-1" style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <span style={{ fontFamily: SANS, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.mute, fontWeight: 700 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  fontFamily: SANS,
  fontSize: 13,
  padding: '7px 9px',
  border: `1px solid ${C.line}`,
  background: '#fff',
  color: C.ink,
  borderRadius: 0,
  outline: 'none',
  width: '100%',
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Select({ children, ...p }) {
  return (
    <select {...p} style={{ ...inputStyle, ...(p.style || {}) }}>
      {children}
    </select>
  );
}
function TextArea(props) {
  return <textarea {...props} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, ...(props.style || {}) }} />;
}

function Btn({ children, onClick, kind = 'primary', size = 'md', disabled, title }) {
  const base = {
    fontFamily: SANS,
    fontWeight: 500,
    letterSpacing: 0.1,
    textTransform: 'none',
    borderRadius: 0,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  };
  const sizes = { sm: { fontSize: 12, padding: '7px 13px' }, md: { fontSize: 13.5, padding: '13px 24px' } };
  const kinds = {
    primary: { background: C.green, color: '#fff', border: `1px solid ${C.green}` },
    brass: { background: C.brass, color: '#fff', border: `1px solid ${C.brass}` },
    ghost: { background: '#fff', color: C.green, border: `1px solid ${C.line}` },
    danger: { background: 'transparent', color: C.red, border: `1px solid ${C.red}44` },
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} style={{ ...base, ...sizes[size], ...kinds[kind] }}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto"
      style={{ background: 'rgba(22,35,58,0.42)', zIndex: 50, padding: 16 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ maxWidth: wide ? 880 : 560, background: C.card, border: `1px solid ${C.line}`, marginTop: 24, marginBottom: 40 }}
      >
        <div className="flex items-center justify-between" style={{ padding: '17px 22px', background: C.green }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 19, color: C.brass, margin: 0, letterSpacing: -0.2 }}>{title}</h3>
          <button onClick={onClose} style={{ color: C.brass, opacity: 0.8, cursor: 'pointer' }}>
            <X size={17} />
          </button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div style={{ padding: '64px 24px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ borderTop: `2px solid ${C.brass}`, paddingTop: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <Icon size={15} style={{ color: C.brass }} />
          <Eyebrow>01 / Begin</Eyebrow>
        </div>
        <Headline size={26} style={{ marginBottom: 10 }}>{title}</Headline>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.mute, lineHeight: 1.7, marginBottom: 20 }}>{hint}</div>
        {action}
      </div>
    </div>
  );
}

/* ============================================================
   MAIN
   ============================================================ */
export default function App() {
  const [data, setData] = useState(SEED);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('candidates');
  const [mode, setMode] = useState('table');
  const [q, setQ] = useState('');
  const [fTag, setFTag] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [fOwner, setFOwner] = useState('');
  const [open, setOpen] = useState(null); // candidate id
  const [modal, setModal] = useState(null);

  useEffect(() => {
    if (document.getElementById('ccp-fonts')) return;
    const l = document.createElement('link');
    l.id = 'ccp-fonts';
    l.rel = 'stylesheet';
    l.href = FONT_HREF;
    document.head.appendChild(l);
  }, []);

  /* ---- load ---- */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(CORE_KEY, true);
        const parsed = r && r.value ? JSON.parse(r.value) : null;
        if (parsed) {
          const next = {
            candidates: parsed.candidates || [],
            searches: parsed.searches || [],
            clients: parsed.clients || [],
            contacts: parsed.contacts || [],
            meta: { tags: parsed.meta?.tags?.length ? parsed.meta.tags : DEFAULT_TAGS, owners: parsed.meta?.owners || SEED.meta.owners },
          };
          // Older candidates carried a single searchId. Widen to a list, and give
          // each search its own stage so one person can run in several processes.
          next.candidates = next.candidates.map((c) => {
            if (c.searchIds) return c;
            const ids = c.searchId ? [c.searchId] : [];
            const stages = c.searchId ? { [c.searchId]: c.stage || 'identified' } : {};
            return { ...c, searchIds: ids, stages };
          });

          // Older searches stored the client as loose text. Bind each one to a real
          // company record so every entity can be reached from every other.
          let changed = true;
          const clients = [...next.clients];
          next.searches = next.searches.map((sr) => {
            if (sr.clientId) return sr;
            const name = (sr.client || '').trim();
            if (!name) return sr;
            let match = clients.find((c) => (c.name || '').toLowerCase() === name.toLowerCase());
            if (!match) {
              match = { id: uid('cl'), name, type: 'Direct', contactName: '', contactTitle: '', email: '', phone: '', status: 'Active', notes: '' };
              clients.push(match);
            }
            changed = true;
            return { ...sr, clientId: match.id };
          });
          next.clients = clients;
          setData(next);
          if (changed) { try { await window.storage.set(CORE_KEY, JSON.stringify(next), true); } catch (e) { /* retry on next edit */ } }
        }
      } catch (e) {
        // no record yet, start clean
      }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    setSaving(true);
    try {
      await window.storage.set(CORE_KEY, JSON.stringify(next), true);
      setErr(null);
    } catch (e) {
      setErr('Changes did not save. Check your connection and edit the record again.');
    }
    setSaving(false);
  }, []);

  /* ---- mutations ---- */
  const addNote = (cand, body, kind = 'note') =>
    [...(cand.notes || []), { id: uid('n'), ts: nowISO(), kind, body }];

  const upsertCandidate = (c) => {
    const exists = data.candidates.some((x) => x.id === c.id);
    const next = exists
      ? data.candidates.map((x) => (x.id === c.id ? { ...c, updatedAt: nowISO() } : x))
      : [{ ...c, createdAt: nowISO(), updatedAt: nowISO() }, ...data.candidates];
    persist({ ...data, candidates: next });
  };

  const patchCandidate = (id, patch, autoNote) => {
    const next = data.candidates.map((c) => {
      if (c.id !== id) return c;
      const updated = { ...c, ...patch, updatedAt: nowISO() };
      if (autoNote) updated.notes = addNote(c, autoNote, 'system');
      return updated;
    });
    persist({ ...data, candidates: next });
  };

  const removeCandidate = (id) => persist({ ...data, candidates: data.candidates.filter((c) => c.id !== id) });

  const logTouch = (id) =>
    patchCandidate(id, { lastContactAt: nowISO() }, 'Contact logged');

  const setStage = (id, stage, sid) => {
    const c = data.candidates.find((x) => x.id === id);
    if (!c) return;
    const label = sid && searchById[sid]
      ? `${searchById[sid].role}: stage moved to ${stageOf(stage).label}`
      : `Stage moved to ${stageOf(stage).label}`;
    const patch = { stage, lastContactAt: nowISO() };
    if (sid) patch.stages = { ...(c.stages || {}), [sid]: stage };
    patchCandidate(id, patch, label);
  };

  const setInterview = (id, sid, patch) => {
    const c = data.candidates.find((x) => x.id === id);
    if (!c || !sid) return;
    const cur = (c.interviews || {})[sid] || { date: '', round: 'First round' };
    const merged = { ...cur, ...patch };
    const sr = searchById[sid];
    const label = merged.date
      ? `${sr?.role || 'Search'}: ${merged.round || 'Interview'} set for ${fmtDate(merged.date)}`
      : `${sr?.role || 'Search'}: interview date cleared`;
    patchCandidate(id, { interviews: { ...(c.interviews || {}), [sid]: merged } }, label);
  };

  // adds a search to a candidate rather than replacing what they already run in
  const addToSearch = (ids, sid) => {
    const set = new Set(ids);
    const sr = data.searches.find((x) => x.id === sid);
    const next = data.candidates.map((c) => {
      if (!set.has(c.id)) return c;
      const cur = searchIdsOf(c);
      if (cur.includes(sid)) return c;
      return {
        ...c,
        searchIds: [...cur, sid],
        stages: { ...(c.stages || {}), [sid]: 'identified' },
        updatedAt: nowISO(),
        notes: [...(c.notes || []), { id: uid('n'), ts: nowISO(), kind: 'system', body: `Added to ${sr?.client} - ${sr?.role}` }],
      };
    });
    persist({ ...data, candidates: next });
  };

  const removeFromSearch = (id, sid) => {
    const c = data.candidates.find((x) => x.id === id);
    if (!c) return;
    const sr = searchById[sid];
    const stages = { ...(c.stages || {}) };
    delete stages[sid];
    patchCandidate(id, { searchIds: searchIdsOf(c).filter((x) => x !== sid), stages },
      `Removed from ${sr?.client} - ${sr?.role}`);
  };

  const bulkPatch = (ids, patch, label) => {
    const set = new Set(ids);
    const next = data.candidates.map((c) => {
      if (!set.has(c.id)) return c;
      const updated = { ...c, ...patch, updatedAt: nowISO() };
      if (label) updated.notes = [...(c.notes || []), { id: uid('n'), ts: nowISO(), kind: 'system', body: label }];
      return updated;
    });
    persist({ ...data, candidates: next });
  };

  const commitImports = async (items) => {
    await persist({ ...data, candidates: [...items.map((i) => i.candidate), ...data.candidates] });
    for (const i of items) {
      try {
        if (i.resumeText) await window.storage.set(RESUME_PREFIX + i.candidate.id, i.resumeText, true);
        if (i.cvFile) await window.storage.set(CVFILE_PREFIX + i.candidate.id, JSON.stringify(i.cvFile), true);
      } catch (e) {
        setErr('Some CV files were too large to store. The candidate records were still created.');
      }
    }
    setModal(null);
    setView('candidates');
  };

  const upsertSearch = (s) => {
    const exists = data.searches.some((x) => x.id === s.id);
    persist({
      ...data,
      searches: exists ? data.searches.map((x) => (x.id === s.id ? s : x)) : [s, ...data.searches],
    });
  };
  // A search and a brand new company must be written in a single operation.
  // Two separate writes would each work from the same snapshot, and the second
  // would silently discard the first.
  const saveSearch = (sr, newClient, newContact) => {
    const exists = data.searches.some((x) => x.id === sr.id);
    persist({
      ...data,
      clients: newClient ? [newClient, ...data.clients] : data.clients,
      contacts: newContact ? [newContact, ...data.contacts] : data.contacts,
      searches: exists ? data.searches.map((x) => (x.id === sr.id ? sr : x)) : [sr, ...data.searches],
    });
  };

  const upsertContact = (ct) => {
    const exists = data.contacts.some((x) => x.id === ct.id);
    persist({
      ...data,
      contacts: exists ? data.contacts.map((x) => (x.id === ct.id ? ct : x)) : [ct, ...data.contacts],
    });
  };
  const removeContact = (id) => persist({ ...data, contacts: data.contacts.filter((c) => c.id !== id) });

  const upsertClient = (cl) => {
    const exists = data.clients.some((x) => x.id === cl.id);
    persist({
      ...data,
      clients: exists ? data.clients.map((x) => (x.id === cl.id ? cl : x)) : [cl, ...data.clients],
    });
  };

  /* ---- derived ---- */
  const tags = data.meta.tags;
  const searchById = useMemo(() => Object.fromEntries(data.searches.map((s) => [s.id, s])), [data.searches]);
  const clientById = useMemo(() => Object.fromEntries(data.clients.map((c) => [c.id, c])), [data.clients]);

  const goTo = (type, id) => {
    setModal(null);
    setOpen(null);
    if (type === 'candidate') { setView('candidates'); setOpen(id); }
    else if (type === 'search') { setFSearch(id); setQ(''); setFTag(''); setFOwner(''); setMode('board'); setView('candidates'); }
    else if (type === 'client') { setView('clients'); setModal({ type: 'client', payload: data.clients.find((c) => c.id === id) }); }
    else if (type === 'contact') { setView('contacts'); setModal({ type: 'contact', payload: data.contacts.find((c) => c.id === id) }); }
  };

  const rel = useMemo(() => ({
    searchesOfClient: (id) => data.searches.filter((s) => s.clientId === id),
    contactsOfClient: (id) => data.contacts.filter((c) => c.clientId === id),
    candidatesOfSearch: (id) => data.candidates.filter((c) => searchIdsOf(c).includes(id)),
    candidatesOfClient: (id) => {
      const ids = new Set(data.searches.filter((s) => s.clientId === id).map((s) => s.id));
      return data.candidates.filter((c) => searchIdsOf(c).some((sid) => ids.has(sid)));
    },
    clientOfSearch: (sid) => clientById[searchById[sid]?.clientId],
    contactsForCandidate: (cand) => {
      const cids = new Set(searchIdsOf(cand).map((sid) => searchById[sid]?.clientId).filter(Boolean));
      return data.contacts.filter((c) => cids.has(c.clientId));
    },
  }), [data, clientById, searchById]);

  const nav = { goTo, rel, clientById, searchById };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.candidates.filter((c) => {
      if (fTag && !(c.functionTags || []).includes(fTag)) return false;
      if (fSearch && !searchIdsOf(c).includes(fSearch)) return false;
      if (fOwner && c.owner !== fOwner) return false;
      if (!needle) return true;
      return [c.name, c.title, c.company, c.location, c.source, c.nextStep]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [data.candidates, q, fTag, fSearch, fOwner]);

  const exportCSV = () => {
    const cols = ['Name', 'Title', 'Company', 'Function Tags', 'Search', 'Stage', 'Owner', 'Email', 'Phone', 'LinkedIn', 'Location', 'Current Comp', 'Target Comp', 'Source', 'Resume Link', 'Next Step', 'Next Step Date', 'Interviews', 'Last Contact', 'Notes Count'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filtered.map((c) =>
      [
        c.name, c.title, c.company, (c.functionTags || []).join('; '),
        searchIdsOf(c).map((sid) => searchById[sid] ? `${searchById[sid].client} - ${searchById[sid].role}` : '').filter(Boolean).join('; '),
        searchIdsOf(c).map((sid) => `${searchById[sid]?.role || 'Search'}: ${stageOf(stageFor(c, sid)).label}`).join('; ') || stageOf(c.stage).label, c.owner, c.email, c.phone, c.linkedin, c.location,
        c.compCurrent, c.compTarget, c.source, c.resumeLink, c.nextStep,
        c.nextStepDate ? fmtDate(c.nextStepDate) : '',
        Object.entries(c.interviews || {}).filter(([, v]) => v && v.date)
          .map(([sid, v]) => `${searchById[sid]?.role || 'Search'}: ${v.round || 'Interview'} ${fmtDate(v.date)}`).join('; '),
        fmtDate(c.lastContactAt || c.updatedAt), (c.notes || []).length,
      ].map(esc).join(',')
    );
    const blob = new Blob([[cols.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `CCP-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 320, background: C.paper }}>
        <Loader2 size={20} className="animate-spin" style={{ color: C.green }} />
      </div>
    );
  }

  const NAV = [
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'searches', label: 'Searches', icon: Briefcase },
    { id: 'clients', label: 'Companies', icon: Building2 },
    { id: 'contacts', label: 'Contacts', icon: Mail },
  ];

  return (
    <div style={{ background: C.paper, minHeight: '100vh', fontFamily: SANS, color: C.ink }}>
      {/* ---------- masthead ---------- */}
      <div style={{ background: C.paper, color: C.green, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3" style={{ padding: '20px 26px 16px' }}>
          <div className="flex items-center gap-3">
            <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
              <path d="M2 12 L13 2 L24 12" stroke={C.brass} strokeWidth="3.4" fill="none" strokeLinejoin="miter" />
              <path d="M2 18 L13 8 L24 18" stroke={C.green} strokeWidth="3.4" fill="none" strokeLinejoin="miter" />
            </svg>
            <div>
              <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: 1.6, textTransform: 'uppercase', lineHeight: 1.1, color: C.green }}>
                Career Capital Partners
              </div>
              <div style={{ fontSize: 9.5, letterSpacing: 2.4, textTransform: 'uppercase', color: C.brass, fontWeight: 500, marginTop: 4, fontFamily: SANS }}>
                Search Ledger
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving ? (
              <span style={{ fontSize: 11.5, color: C.mute }}>Saving</span>
            ) : (
              <span className="flex items-center gap-1" style={{ fontSize: 11.5, color: C.mute }}>
                <Check size={12} /> Saved
              </span>
            )}
            <Btn kind="ghost" size="sm" onClick={() => setModal({ type: 'candidate' })}>
              <Plus size={13} /> Candidate
            </Btn>
            <Btn size="sm" onClick={() => setModal({ type: 'cv' })}>
              Import CVs <ArrowRight size={13} />
            </Btn>
            <Btn kind="ghost" size="sm" onClick={() => setModal({ type: 'settings' })}>
              <Settings size={13} />
            </Btn>
          </div>
        </div>
        <div className="flex" style={{ padding: '0 26px', overflowX: 'auto' }}>
          {NAV.map((n) => {
            const on = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className="flex items-center gap-2"
                style={{
                  padding: '11px 18px',
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: 1.8,
                  textTransform: 'uppercase',
                  color: on ? C.brass : 'rgba(255,255,255,0.6)',
                  borderBottom: `2px solid ${on ? C.brass : 'transparent'}`,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <n.icon size={13} /> {n.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: C.paper, borderBottom: `1px solid ${C.line}`, padding: '10px 26px' }}>
        <span style={{ fontFamily: SERIF, fontSize: 14, color: C.mute, fontStyle: 'italic' }}>
          Leadership is the capital that compounds.
        </span>
      </div>

      {err && (
        <div className="flex items-center gap-2" style={{ background: '#FBEAE6', color: C.red, padding: '8px 18px', fontSize: 12 }}>
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {/* ---------- filter bar ---------- */}
      {view === 'candidates' && (
        <div className="flex flex-wrap items-center gap-2" style={{ padding: '10px 18px', borderBottom: `1px solid ${C.line}`, background: C.card }}>
          <div className="flex items-center gap-2" style={{ border: `1px solid ${C.line}`, padding: '5px 8px', background: '#fff', minWidth: 190, flex: '1 1 190px', maxWidth: 300 }}>
            <SearchIcon size={13} style={{ color: C.mute }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, title, company"
              style={{ border: 'none', outline: 'none', fontSize: 12.5, width: '100%', fontFamily: SANS }}
            />
          </div>
          <Select value={fTag} onChange={(e) => setFTag(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
            <option value="">All functions</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select value={fSearch} onChange={(e) => setFSearch(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
            <option value="">All searches</option>
            {data.searches.map((s) => <option key={s.id} value={s.id}>{s.client} - {s.role}</option>)}
          </Select>
          <Select value={fOwner} onChange={(e) => setFOwner(e.target.value)} style={{ width: 'auto', minWidth: 120 }}>
            <option value="">All owners</option>
            {data.meta.owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
          <span style={{ fontSize: 11.5, color: C.mute, marginLeft: 'auto' }}>{filtered.length} shown</span>
          <Btn kind="ghost" size="sm" onClick={exportCSV}><Download size={12} /> CSV</Btn>
        </div>
      )}

      <div style={{ padding: '30px 26px 40px' }}>
        {view === 'candidates' && mode === 'board' && (
          <PipelineView rows={filtered} tags={tags} onOpen={setOpen} onStage={setStage}
            onAdd={() => setModal({ type: 'candidate' })} activeSearch={fSearch} searchById={searchById}
            mode={mode} setMode={setMode} onBulk={() => setModal({ type: 'bulk' })} onCV={() => setModal({ type: 'cv' })} />
        )}
        {view === 'candidates' && mode === 'table' && (
          <CandidatesTable rows={filtered} tags={tags} searchById={searchById} onOpen={setOpen} onStage={setStage} onTouch={logTouch}
            onAdd={() => setModal({ type: 'candidate' })} onBulk={() => setModal({ type: 'bulk' })}
            onCV={() => setModal({ type: 'cv' })}
            searches={data.searches} owners={data.meta.owners} onBulkPatch={bulkPatch}
            onDelete={removeCandidate} mode={mode} setMode={setMode}
            activeSearch={fSearch} onAddToSearch={addToSearch} onInterview={setInterview} />
        )}
        {view === 'searches' && (
          <SearchesView searches={data.searches} candidates={data.candidates} tags={tags} nav={nav}
            onAdd={() => setModal({ type: 'search' })} onEdit={(s) => setModal({ type: 'search', payload: s })}
            onJump={(id) => { setFSearch(id); setMode('board'); setView('candidates'); }}
            onAssign={(sr) => setModal({ type: 'assign', payload: sr })} />
        )}
        {view === 'contacts' && (
          <ContactsView contacts={data.contacts} clients={data.clients} nav={nav}
            onAdd={() => setModal({ type: 'contact' })} onEdit={(c) => setModal({ type: 'contact', payload: c })} />
        )}
        {view === 'clients' && (
          <ClientsView clients={data.clients} nav={nav}
            onAdd={() => setModal({ type: 'client' })} onEdit={(c) => setModal({ type: 'client', payload: c })} />
        )}
      </div>

      <div style={{ padding: '20px 26px', borderTop: `1px solid ${C.line}` }}>
        <Eyebrow color={C.mute}>Career Capital Partners &nbsp;·&nbsp; Private &amp; Confidential &nbsp;·&nbsp; Shared with everyone who has access</Eyebrow>
      </div>

      {/* ---------- modals ---------- */}
      {modal?.type === 'candidate' && (
        <CandidateForm
          tags={tags} searches={data.searches} owners={data.meta.owners}
          onClose={() => setModal(null)}
          onSave={(c) => { upsertCandidate(c); setModal(null); }}
        />
      )}
      {modal?.type === 'search' && (
        <SearchForm record={modal.payload} tags={tags} clients={data.clients} owners={data.meta.owners} contacts={data.contacts}
          onClose={() => setModal(null)} onSave={(sr, newClient, newContact) => { saveSearch(sr, newClient, newContact); setModal(null); }} />
      )}
      {modal?.type === 'client' && (
        <ClientForm record={modal.payload} nav={nav} onClose={() => setModal(null)} onSave={(c) => { upsertClient(c); setModal(null); }} />
      )}
      {modal?.type === 'assign' && (
        <AssignCandidates
          search={modal.payload}
          candidates={data.candidates}
          searchById={searchById}
          tags={tags}
          onClose={() => setModal(null)}
          onAssign={(ids) => {
            addToSearch(ids, modal.payload.id);
            setModal(null);
          }}
          onCreate={(name) => {
            const c = {
              id: uid('c'), name, title: '', company: '', email: '', phone: '', linkedin: '', location: '',
              functionTags: modal.payload.functionTags || [], searchIds: [modal.payload.id],
              stages: { [modal.payload.id]: 'identified' }, stage: 'identified',
              owner: modal.payload.owner || '', source: 'Added from search', compCurrent: '', compTarget: '',
              resumeLink: '', nextStep: '', nextStepDate: '', lastContactAt: nowISO(),
              createdAt: nowISO(), updatedAt: nowISO(),
              notes: [{ id: uid('n'), ts: nowISO(), kind: 'system', body: `Created on ${modal.payload.role}` }],
            };
            persist({ ...data, candidates: [c, ...data.candidates] });
            setModal(null);
            setOpen(c.id);
            setView('candidates');
          }}
        />
      )}
      {modal?.type === 'contact' && (
        <ContactForm record={modal.payload} clients={data.clients} owners={data.meta.owners} nav={nav}
          onClose={() => setModal(null)}
          onSave={(c) => { upsertContact(c); setModal(null); }}
          onDelete={(id) => { removeContact(id); setModal(null); }} />
      )}
      {modal?.type === 'bulk' && (
        <BulkAdd tags={tags} searches={data.searches} owners={data.meta.owners}
          onClose={() => setModal(null)}
          onSave={(list) => { persist({ ...data, candidates: [...list, ...data.candidates] }); setModal(null); }} />
      )}
      {modal?.type === 'cv' && (
        <CVImport tags={tags} searches={data.searches} owners={data.meta.owners}
          onClose={() => setModal(null)} onCommit={commitImports} />
      )}
      {modal?.type === 'settings' && (
        <SettingsForm meta={data.meta} onClose={() => setModal(null)}
          onSave={(meta) => { persist({ ...data, meta }); setModal(null); }} />
      )}

      {open && (
        <CandidateDrawer
          candidate={data.candidates.find((c) => c.id === open)}
          tags={tags} searches={data.searches} owners={data.meta.owners} nav={nav}
          onClose={() => setOpen(null)}
          onPatch={patchCandidate}
          onStage={setStage}
          onAddToSearch={addToSearch}
          onRemoveFromSearch={removeFromSearch}
          onInterview={setInterview}
          onDelete={(id) => { removeCandidate(id); setOpen(null); }}
        />
      )}
    </div>
  );
}

function Panel({ title, note, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div style={{ padding: '14px 16px 11px', borderBottom: `1px solid ${C.line}` }}>
        {note && <Eyebrow style={{ marginBottom: 5 }}>{note}</Eyebrow>}
        <Headline size={16}>{title}</Headline>
      </div>
      <div style={{ padding: '4px 16px 12px', maxHeight: 330, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}
function Row({ children, onClick }) {
  return (
    <div onClick={onClick} className="flex items-center gap-3" style={{ padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer' }}>
      {children}
    </div>
  );
}
function ViewSwitch({ mode, setMode }) {
  return (
    <div className="flex" style={{ border: `1px solid ${C.line}` }}>
      {[{ id: 'table', l: 'Table' }, { id: 'board', l: 'Board' }].map((m) => (
        <button key={m.id} onClick={() => setMode(m.id)}
          style={{
            padding: '6px 13px', fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
            cursor: 'pointer', background: mode === m.id ? C.brassSoft : '#fff', color: C.brass,
            opacity: mode === m.id ? 1 : 0.6, fontWeight: mode === m.id ? 700 : 500,
          }}>
          {m.l}
        </button>
      ))}
    </div>
  );
}

function RelatedList({ title, items, empty }) {
  return (
    <div>
      <Eyebrow color={C.mute} style={{ marginBottom: 7 }}>{title}</Eyebrow>
      {items.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.mute }}>{empty}</div>
      ) : (
        <div className="flex flex-col" style={{ gap: 3 }}>
          {items.map((it) => (
            <button key={it.key} onClick={it.onClick} className="flex items-center justify-between gap-2"
              style={{ textAlign: 'left', padding: '7px 9px', border: `1px solid ${C.lineSoft}`, background: C.card, cursor: 'pointer', width: '100%' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
              <span className="flex items-center gap-1" style={{ fontSize: 10.5, color: C.mute, flexShrink: 0 }}>{it.sub}<ArrowRight size={11} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Quiet({ children }) {
  return <div style={{ fontSize: 12, color: C.mute, padding: '14px 0', lineHeight: 1.6 }}>{children}</div>;
}

/* ============================================================
   VIEW: PIPELINE (columns by stage)
   ============================================================ */
function PipelineView({ rows, tags, onOpen, onStage, onAdd, mode, setMode, onBulk, onCV, activeSearch, searchById }) {
  if (!rows.length) {
    return <Empty icon={Users} title="No candidates match" hint="Clear the filters above, or add someone new to the pipeline." action={<Btn onClick={onAdd}><Plus size={13} /> Add a candidate</Btn>} />;
  }
  return (
    <div>
      <SectionHead eyebrow={activeSearch && searchById[activeSearch] ? searchById[activeSearch].client : 'The pool'}
        title={activeSearch && searchById[activeSearch] ? searchById[activeSearch].role : 'Candidates'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitch mode={mode} setMode={setMode} />
            <Btn kind="ghost" size="sm" onClick={onCV}><UploadCloud size={12} /> Import CVs</Btn>
            <Btn size="sm" onClick={onAdd}><Plus size={12} /> Add candidate</Btn>
          </div>
        } />
    <div className="flex gap-3" style={{ overflowX: 'auto', paddingBottom: 8 }}>
      {STAGES.map((st) => {
        const col = rows.filter((c) => stageFor(c, activeSearch) === st.id);
        return (
          <div key={st.id} style={{ minWidth: 232, width: 232, flexShrink: 0 }}>
            <div className="flex items-center justify-between" style={{ padding: '7px 9px', background: C.card, border: `1px solid ${C.line}`, borderTop: `3px solid ${st.color}` }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: st.color }}>{st.label}</span>
              <span style={{ fontFamily: SERIF, fontSize: 14, color: C.mute }}>{col.length}</span>
            </div>
            <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
              {col.map((c) => (
                <div key={c.id} onClick={() => onOpen(c.id)} style={{ background: C.card, border: `1px solid ${C.line}`, padding: 10, cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: C.mute }}>{c.company}</div>
                  <div className="flex flex-wrap gap-1" style={{ marginTop: 7 }}>
                    {(c.functionTags || []).slice(0, 2).map((t) => (
                      <Pill key={t} color={tagColor(tags, t)}>{t}</Pill>
                    ))}
                  </div>
                  {(() => {
                    const iv = interviewFor(c, activeSearch) || nextInterview(c);
                    return iv && iv.date ? (
                      <div className="flex items-center gap-1" style={{ marginTop: 7, fontSize: 10.5, color: C.brass, fontWeight: 600 }}>
                        <CalendarClock size={11} /> {iv.round || 'Interview'} · {fmtDate(iv.date)}
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 10, color: C.mute }}>{daysSince(c.lastContactAt || c.updatedAt) ?? 0}d since contact</span>
                    <select
                      value={stageFor(c, activeSearch)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onStage(c.id, e.target.value, activeSearch)}
                      style={{ fontSize: 10, border: `1px solid ${C.line}`, borderRadius: 2, padding: '1px 2px', color: C.mute, background: '#fff' }}
                    >
                      {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

/* ============================================================
   VIEW: CANDIDATE TABLE
   ============================================================ */
function CandidatesTable({ rows, tags, searchById, onOpen, onStage, onTouch, onAdd, onBulk, onCV, searches, owners, onBulkPatch, onDelete, mode, setMode, activeSearch, onAddToSearch, onInterview }) {
  const [sort, setSort] = useState({ key: 'updatedAt', dir: -1 });
  const [sel, setSel] = useState([]);
  const [confirmId, setConfirmId] = useState(null);

  const selSet = useMemo(() => new Set(sel), [sel]);
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allShown = sel.length > 0 && visibleIds.every((id) => selSet.has(id));

  const toggleOne = (id) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleAll = () => setSel(allShown ? [] : visibleIds);

  const apply = (patch, label) => {
    onBulkPatch(sel, patch, label);
    setSel([]);
  };
  const sorted = useMemo(() => {
    const v = (c) => {
      if (sort.key === 'age') return daysSince(c.lastContactAt || c.updatedAt) ?? 0;
      if (sort.key === 'interview') {
        const iv = activeSearch ? interviewFor(c, activeSearch) : nextInterview(c);
        return iv && iv.date ? iv.date : '9999';
      }
      if (sort.key === 'stage') return STAGES.findIndex((s) => s.id === (activeSearch ? stageFor(c, activeSearch) : furthestStage(c)));
      return (c[sort.key] || '').toString().toLowerCase();
    };
    return [...rows].sort((a, b) => (v(a) > v(b) ? sort.dir : v(a) < v(b) ? -sort.dir : 0));
  }, [rows, sort]);

  const H = ({ k, children, w }) => (
    <th
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}
      style={{ textAlign: 'left', padding: '11px 10px', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.mute, fontWeight: 800, cursor: 'pointer', width: w, whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  );

  if (!rows.length) {
    return (
      <div>
        <Empty icon={Users} title="No candidates match" hint="Clear the filters, or drop a stack of CVs below and let them fill themselves in."
          action={<div className="flex gap-2"><Btn onClick={onAdd}><Plus size={13} /> Add candidate</Btn><Btn kind="ghost" onClick={onBulk}><Upload size={13} /> Paste a list</Btn></div>} />
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <Dropzone onFiles={() => onCV()} label="Drop CVs here" hint="PDF, DOCX, TXT, or a photo. Names, titles, contact details, and function tags are read straight off the document." />
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHead eyebrow="The pool" title="Candidates"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitch mode={mode} setMode={setMode} />
            <Btn kind="ghost" size="sm" onClick={onBulk}><Upload size={12} /> Paste a list</Btn>
            <Btn kind="ghost" size="sm" onClick={onCV}><UploadCloud size={12} /> Import CVs</Btn>
            <Btn size="sm" onClick={onAdd}><Plus size={12} /> Add candidate</Btn>
          </div>
        } />
      {sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" style={{ background: C.greenSoft, border: `1px solid ${C.green}33`, padding: '9px 12px', marginBottom: 10 }}>
          <span style={{ fontFamily: SERIF, fontSize: 15, color: C.green, minWidth: 78 }}>{sel.length} selected</span>

          <Select value="" onChange={(e) => { if (e.target.value) { onAddToSearch(sel, e.target.value); setSel([]); } }} style={{ width: 'auto', minWidth: 165 }}>
            <option value="">Add to a search</option>
            {searches.map((s) => <option key={s.id} value={s.id}>{s.client} - {s.role}</option>)}
          </Select>

          <Select value="" disabled={!activeSearch} title={activeSearch ? '' : 'Filter by a search first, since stage is per search'}
            onChange={(e) => { if (e.target.value) { sel.forEach((id) => onStage(id, e.target.value, activeSearch)); setSel([]); } }} style={{ width: 'auto', minWidth: 145 }}>
            <option value="">{activeSearch ? 'Set stage' : 'Set stage (filter first)'}</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>

          <Select value="" onChange={(e) => e.target.value && apply({ owner: e.target.value }, `Owner set to ${e.target.value}`)} style={{ width: 'auto', minWidth: 130 }}>
            <option value="">Set owner</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </Select>

          <Btn size="sm" kind="ghost" onClick={() => apply({ lastContactAt: nowISO() }, 'Contact logged')}>Log contact</Btn>
          <Btn size="sm" kind="ghost" onClick={() => setSel([])}>Clear</Btn>
          <span style={{ fontSize: 11, color: C.mute, marginLeft: 'auto' }}>Delete one at a time from the candidate panel</span>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead style={{ background: C.greenSoft, borderBottom: `1px solid ${C.line}` }}>
            <tr>
              <th style={{ width: 34, padding: '9px 0 9px 10px' }}>
                <input type="checkbox" checked={allShown} onChange={toggleAll} title="Select all shown" />
              </th>
              <H k="name">Candidate</H>
              <H k="company">Company</H>
              <H k="functionTags">Function</H>
              <H k="searchId">Search</H>
              <H k="stage" w={150}>Stage</H>
              <H k="owner">Owner</H>
              <H k="interview" w={130}>Interview</H>
              <H k="age" w={70}>Aging</H>
              <th style={{ width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const age = daysSince(c.lastContactAt || c.updatedAt) ?? 0;
              return (
                <tr key={c.id} style={{ borderBottom: `1px solid ${C.lineSoft}`, background: selSet.has(c.id) ? C.brassSoft : 'transparent' }}>
                  <td style={{ padding: '9px 0 9px 10px' }}>
                    <input type="checkbox" checked={selSet.has(c.id)} onChange={() => toggleOne(c.id)} />
                  </td>
                  <td style={{ padding: '9px 10px', cursor: 'pointer' }} onClick={() => onOpen(c.id)}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: C.mute }}>{c.title}</div>
                  </td>
                  <td style={{ padding: '9px 10px', fontSize: 12 }}>{c.company || '-'}</td>
                  <td style={{ padding: '9px 10px' }}>
                    <div className="flex flex-wrap gap-1">
                      {(c.functionTags || []).map((t) => <Pill key={t} color={tagColor(tags, t)}>{t}</Pill>)}
                    </div>
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    <div className="flex flex-wrap gap-1">
                      {searchIdsOf(c).length === 0 && <span style={{ fontSize: 11.5, color: C.mute }}>-</span>}
                      {searchIdsOf(c).map((sid) => (
                        <Pill key={sid} color={sid === activeSearch ? C.brass : C.mute}>
                          {searchById[sid]?.role || 'Search'}
                        </Pill>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    {activeSearch ? (
                      <select value={stageFor(c, activeSearch)} onChange={(e) => onStage(c.id, e.target.value, activeSearch)}
                        style={{ fontSize: 11.5, padding: '4px 5px', border: `1px solid ${C.line}`, background: '#fff', color: stageOf(stageFor(c, activeSearch)).color, fontWeight: 700, width: '100%' }}>
                        {STAGES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                      </select>
                    ) : (
                      <span title="Stage is tracked per search. Filter by a search to change it."
                        style={{ fontSize: 11.5, color: stageOf(furthestStage(c)).color, fontWeight: 700 }}>
                        {stageOf(furthestStage(c)).label}
                        {searchIdsOf(c).length > 1 && <span style={{ color: C.mute, fontWeight: 400 }}> (furthest)</span>}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '9px 10px', fontSize: 11.5 }}>{c.owner || '-'}</td>
                  <td style={{ padding: '9px 10px' }}>
                    {activeSearch ? (
                      <input type="date"
                        value={(interviewFor(c, activeSearch) || {}).date || ''}
                        onChange={(e) => onInterview(c.id, activeSearch, { date: e.target.value })}
                        style={{ fontSize: 11, padding: '3px 4px', border: `1px solid ${C.line}`, background: '#fff', color: C.ink, width: '100%' }} />
                    ) : (() => {
                      const iv = nextInterview(c);
                      return iv && iv.date
                        ? <span style={{ fontSize: 11.5, color: C.brass, fontWeight: 600 }}>{fmtDate(iv.date)}</span>
                        : <span style={{ fontSize: 11.5, color: C.mute }}>-</span>;
                    })()}
                  </td>
                  <td style={{ padding: '9px 10px', fontFamily: SERIF, fontSize: 14, color: age >= 21 ? C.red : age >= 7 ? C.brass : C.mute }}>{age}d</td>
                  <td style={{ padding: '9px 10px' }}>
                    {confirmId === c.id ? (
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 10.5, color: C.red }}>Delete?</span>
                        <Btn size="sm" kind="danger" onClick={() => { onDelete(c.id); setConfirmId(null); }}>Yes</Btn>
                        <Btn size="sm" kind="ghost" onClick={() => setConfirmId(null)}>No</Btn>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Btn size="sm" kind="ghost" onClick={() => onTouch(c.id)}>Touch</Btn>
                        <button title="Delete candidate" onClick={() => setConfirmId(c.id)}
                          style={{ cursor: 'pointer', color: C.mute, padding: 4 }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   VIEW: SEARCHES
   ============================================================ */
function SearchesView({ searches, candidates, tags, nav, onAdd, onEdit, onJump, onAssign }) {
  if (!searches.length) {
    return <Empty icon={Briefcase} title="No searches yet" hint="A search is one client mandate: company, role, function, owner, and target close date. Candidates get logged against it."
      action={<Btn onClick={onAdd}><Plus size={13} /> Add a search</Btn>} />;
  }
  return (
    <div>
      <SectionHead eyebrow="Mandates" title="Active searches"
        action={<Btn size="sm" onClick={onAdd}><Plus size={12} /> Add search</Btn>} />
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {searches.map((s) => {
          const mine = candidates.filter((c) => searchIdsOf(c).includes(s.id));
          const statusColor = s.status === 'Active' ? C.green : s.status === 'On Hold' ? C.brass : s.status === 'Business Development' ? '#3F6C8A' : C.mute;
          return (
            <div key={s.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${statusColor}`, padding: 14 }}>
              <div className="flex items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 16, color: C.green, lineHeight: 1.2 }}>{s.role}</div>
                  <button onClick={() => s.clientId && nav.goTo('client', s.clientId)}
                    style={{ fontSize: 12, color: s.clientId ? C.brass : C.mute, marginTop: 2, cursor: s.clientId ? 'pointer' : 'default', fontWeight: 600, textAlign: 'left' }}>
                    {nav.clientById[s.clientId]?.name || s.client}
                  </button>
                </div>
                <Pill color={statusColor} filled>{s.status}</Pill>
              </div>
              <div className="flex flex-wrap gap-1" style={{ marginTop: 9 }}>
                {(s.functionTags || []).map((t) => <Pill key={t} color={tagColor(tags, t)}>{t}</Pill>)}
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, fontSize: 11.5 }}>
                <Meta k="Owner" v={s.owner} />
                <Meta k="Opened" v={fmtDate(s.startDate)} />
                <Meta k="Target close" v={fmtDate(s.targetDate)} />
                <Meta k="Fee" v={s.fee} />
              </div>
              {s.notes && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 10, lineHeight: 1.55 }}>{s.notes}</div>}
              {(() => {
                const booked = candidates
                  .filter((c) => searchIdsOf(c).includes(s.id))
                  .map((c) => ({ c, iv: interviewFor(c, s.id) }))
                  .filter((x) => x.iv && x.iv.date)
                  .sort((a, b) => a.iv.date.localeCompare(b.iv.date));
                if (!booked.length) return null;
                return (
                  <div style={{ marginTop: 12 }}>
                    <Eyebrow color={C.mute} style={{ marginBottom: 7 }}>Interviews booked</Eyebrow>
                    <div className="flex flex-col" style={{ gap: 3 }}>
                      {booked.slice(0, 5).map(({ c, iv }) => (
                        <div key={c.id} className="flex items-center justify-between gap-2"
                          style={{ fontSize: 11.5, borderBottom: `1px solid ${C.lineSoft}`, padding: '4px 0' }}>
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                          <span style={{ color: C.brass, fontWeight: 600, flexShrink: 0 }}>{iv.round || 'Interview'} · {fmtDate(iv.date)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {s.clientId && (() => {
                const all = nav.rel.contactsOfClient(s.clientId);
                const picked = (s.contactIds || []).length
                  ? all.filter((ct) => s.contactIds.includes(ct.id))
                  : all;
                return (
                  <div style={{ marginTop: 12 }}>
                    <Eyebrow color={C.mute} style={{ marginBottom: 7 }}>
                      {(s.contactIds || []).length ? 'Point of contact' : 'Contacts on this account'}
                    </Eyebrow>
                    {picked.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: C.mute }}>None yet. Edit the search to add one.</div>
                    ) : (
                      <div className="flex flex-col" style={{ gap: 3 }}>
                        {picked.map((ct) => (
                          <button key={ct.id} onClick={() => nav.goTo('contact', ct.id)}
                            style={{ textAlign: 'left', border: `1px solid ${C.lineSoft}`, background: C.card, padding: '8px 10px', cursor: 'pointer', width: '100%' }}>
                            <div className="flex items-center justify-between gap-2">
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{ct.name}</span>
                              {ct.role && <Pill color={C.brass}>{ct.role}</Pill>}
                            </div>
                            {ct.title && <div style={{ fontSize: 11, color: C.mute, marginTop: 1 }}>{ct.title}</div>}
                            <div className="flex flex-wrap gap-3" style={{ marginTop: 4 }}>
                              {ct.email && <span className="flex items-center gap-1" style={{ fontSize: 11, color: C.green }}><Mail size={10} /> {ct.email}</span>}
                              {ct.phone && <span className="flex items-center gap-1" style={{ fontSize: 11, color: C.mute }}><Phone size={10} /> {ct.phone}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="flex items-center justify-between" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.lineSoft}` }}>
                <span style={{ fontSize: 11.5 }}>
                  <strong style={{ fontFamily: SERIF, fontSize: 15, color: C.brass }}>{mine.length}</strong>
                  <span style={{ color: C.mute }}> candidates</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" kind="ghost" onClick={() => onEdit(s)}>Edit</Btn>
                  <Btn size="sm" kind="ghost" onClick={() => onJump(s.id)}>Open board</Btn>
                  <Btn size="sm" onClick={() => onAssign(s)}><Plus size={12} /> Add candidates</Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function Meta({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, letterSpacing: 0.7, textTransform: 'uppercase', color: C.mute, fontWeight: 700 }}>{k}</div>
      <div style={{ fontSize: 12 }}>{v || '-'}</div>
    </div>
  );
}

/* ============================================================
   VIEW: CLIENTS
   ============================================================ */
function ClientsView({ clients, nav, onAdd, onEdit }) {
  if (!clients.length) {
    return <Empty icon={Building2} title="No companies yet"
      hint="Sponsors, portfolio companies, and direct clients live here. Every search and every contact hangs off a company record."
      action={<Btn onClick={onAdd}><Plus size={13} /> Add a company</Btn>} />;
  }
  return (
    <div>
      <SectionHead eyebrow="The accounts" title="Companies"
        action={<Btn size="sm" onClick={onAdd}><Plus size={12} /> Add company</Btn>} />
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' }}>
        {clients.map((cl) => {
          const srch = nav.rel.searchesOfClient(cl.id);
          const cts = nav.rel.contactsOfClient(cl.id);
          const cands = nav.rel.candidatesOfClient(cl.id);
          const statusColor = cl.status === 'Active' ? C.green : cl.status === 'Prospect' ? C.brass : C.mute;
          return (
            <div key={cl.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${statusColor}`, padding: 14 }}>
              <div className="flex items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 16, color: C.green, lineHeight: 1.2 }}>{cl.name}</div>
                  <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{cl.type}</div>
                </div>
                <Pill color={statusColor} filled>{cl.status}</Pill>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 12 }}>
                {[{ n: srch.length, l: 'Searches' }, { n: cts.length, l: 'Contacts' }, { n: cands.length, l: 'Candidates' }].map((x) => (
                  <div key={x.l} style={{ background: C.greenSoft, padding: '7px 8px' }}>
                    <div style={{ fontFamily: SERIF, fontSize: 19, color: C.green, lineHeight: 1 }}>{x.n}</div>
                    <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: C.mute, fontWeight: 700, marginTop: 3 }}>{x.l}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3" style={{ marginTop: 12 }}>
                <RelatedList title="Searches" empty="No searches on this account."
                  items={srch.map((sr) => ({ key: sr.id, label: sr.role, sub: sr.status, onClick: () => nav.goTo('search', sr.id) }))} />
                <RelatedList title="Contacts" empty="No contacts yet."
                  items={cts.map((ct) => ({ key: ct.id, label: ct.name, sub: ct.role || ct.title, onClick: () => nav.goTo('contact', ct.id) }))} />
              </div>

              <div className="flex justify-end" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.lineSoft}` }}>
                <Btn size="sm" kind="ghost" onClick={() => onEdit(cl)}>Edit company</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ============================================================
   CANDIDATE DRAWER
   ============================================================ */
function CandidateDrawer({ candidate, tags, searches, owners, nav, onClose, onPatch, onStage, onDelete, onAddToSearch, onRemoveFromSearch, onInterview }) {
  const [note, setNote] = useState('');
  const [resume, setResume] = useState('');
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);
  const [tab, setTab] = useState('notes');
  const [confirmDel, setConfirmDel] = useState(false);
  const [cvFile, setCvFile] = useState(null);
  const [cvStatus, setCvStatus] = useState(null);

  useEffect(() => {
    let live = true;
    setCvFile(null);
    if (!candidate?.hasCvFile) return;
    (async () => {
      try {
        const r = await window.storage.get(CVFILE_PREFIX + candidate.id, true);
        if (live && r?.value) setCvFile(JSON.parse(r.value));
      } catch (e) { /* nothing attached */ }
    })();
    return () => { live = false; };
  }, [candidate?.id, candidate?.hasCvFile]);

  const attachCV = async (files) => {
    const file = files[0];
    if (!file) return;
    setCvStatus({ kind: 'busy', msg: `Reading ${file.name}` });
    try {
      const p = await parseCV(file, tags);
      const text = buildResumeText(p);
      setResume(text);
      await window.storage.set(RESUME_PREFIX + candidate.id, text, true);

      const packed = await packCVFile(file).catch(() => null);
      if (packed) await window.storage.set(CVFILE_PREFIX + candidate.id, JSON.stringify(packed), true);
      setCvFile(packed);

      // fill only what is currently blank, never overwrite the recruiter's own entries
      const patch = { hasResumeText: true, hasCvFile: !!packed, cvFileName: packed ? file.name : '' };
      ['name', 'title', 'company', 'email', 'phone', 'linkedin', 'location', 'seniority', 'compCurrent'].forEach((k) => {
        if (!candidate[k] && p[k]) patch[k] = p[k];
      });
      const merged = Array.from(new Set([...(candidate.functionTags || []), ...(p.functionTags || [])]));
      if (merged.length) patch.functionTags = merged;

      const newNotes = [...(candidate.notes || [])];
      if (p.summary) newNotes.push({ id: uid('n'), ts: nowISO(), kind: 'note', body: p.summary });
      if (p.highlights?.length) newNotes.push({ id: uid('n'), ts: nowISO(), kind: 'note', body: p.highlights.map((h) => `- ${h}`).join('\n') });
      newNotes.push({ id: uid('n'), ts: nowISO(), kind: 'system', body: `CV attached: ${file.name}` });
      patch.notes = newNotes;

      onPatch(candidate.id, patch);
      setCvStatus({ kind: 'ok', msg: packed ? 'CV read and attached.' : 'CV read. The file was too large to store, so only the text was kept.' });
    } catch (e) {
      setCvStatus({ kind: 'error', msg: e.message || 'That CV could not be read.' });
    }
  };

  useEffect(() => {
    let live = true;
    setResumeLoaded(false);
    (async () => {
      let text = '';
      try {
        const r = await window.storage.get(RESUME_PREFIX + candidate.id, true);
        text = r?.value || '';
      } catch (e) { text = ''; }
      if (live) { setResume(text); setResumeLoaded(true); }
    })();
    return () => { live = false; };
  }, [candidate?.id]);

  if (!candidate) return null;
  const c = candidate;

  const saveResume = async () => {
    setResumeSaving(true);
    try {
      await window.storage.set(RESUME_PREFIX + c.id, resume, true);
      onPatch(c.id, { hasResumeText: resume.trim().length > 0 }, 'Resume text saved');
    } catch (e) { /* surfaced by the button state */ }
    setResumeSaving(false);
  };

  const postNote = () => {
    if (!note.trim()) return;
    onPatch(c.id, { lastContactAt: nowISO(), notes: [...(c.notes || []), { id: uid('n'), ts: nowISO(), kind: 'note', body: note.trim() }] });
    setNote('');
  };

  const toggleTag = (t) => {
    const cur = c.functionTags || [];
    onPatch(c.id, { functionTags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
  };

  const age = daysSince(c.lastContactAt || c.updatedAt) ?? 0;

  return (
    <div className="fixed inset-0 flex justify-end" style={{ background: 'rgba(22,35,58,0.42)', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full flex flex-col"
        style={{ maxWidth: 520, background: C.paper, height: '100%', overflowY: 'auto' }}>
        {/* head */}
        <div style={{ background: C.green, color: '#fff', padding: '16px 18px' }}>
          <div className="flex items-start justify-between gap-3">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.15, color: C.brass }}>{c.name}</div>
              <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>{c.title}{c.company ? ` · ${c.company}` : ''}</div>
              <div style={{ fontSize: 11.5, opacity: 0.6 }}>{c.location}</div>
            </div>
            <button onClick={onClose} style={{ color: C.brass, cursor: 'pointer' }}><X size={18} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 12 }}>
            <Pill color={C.brass} filled>{stageOf(furthestStage(c)).label}</Pill>
            <span style={{ fontSize: 11, opacity: 0.7 }}>Last contact {fmtDate(c.lastContactAt || c.updatedAt)} · {age}d</span>
            <Btn size="sm" kind="brass" onClick={() => onPatch(c.id, { lastContactAt: nowISO() }, 'Contact logged')}>Log contact</Btn>
            <Btn size="sm" kind="ghost" onClick={() => setTab('details')}>
              <span style={{ color: '#fff' }}>Edit profile</span>
            </Btn>
          </div>
        </div>

        {/* contact strip */}
        <div className="flex flex-wrap gap-3" style={{ padding: '10px 18px', background: C.card, borderBottom: `1px solid ${C.line}`, fontSize: 11.5 }}>
          {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1" style={{ color: C.green }}><Mail size={12} /> {c.email}</a>}
          {c.phone && <span className="flex items-center gap-1" style={{ color: C.mute }}><Phone size={12} /> {c.phone}</span>}
          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ color: C.green }}><Linkedin size={12} /> LinkedIn</a>}
          {!c.email && !c.phone && !c.linkedin && <span style={{ color: C.mute }}>No contact details yet. Add them under Details.</span>}
        </div>

        {/* linked records */}
        <div style={{ padding: '12px 18px', background: C.card, borderBottom: `1px solid ${C.line}` }}>
          <div className="flex flex-col gap-3">
            <div>
              <Eyebrow color={C.mute} style={{ marginBottom: 7 }}>Searches in play</Eyebrow>
              {searchIdsOf(c).length === 0 ? (
                <div style={{ fontSize: 11.5, color: C.mute }}>Not on a search yet. Add one under Edit profile.</div>
              ) : (
                <div className="flex flex-col" style={{ gap: 3 }}>
                  {searchIdsOf(c).map((sid) => {
                    const sr = nav.searchById[sid];
                    if (!sr) return null;
                    const st = stageOf(stageFor(c, sid));
                    return (
                      <div key={sid} style={{ border: `1px solid ${C.lineSoft}`, background: C.card, padding: '9px 10px' }}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => nav.goTo('search', sid)} className="flex-1" style={{ textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{sr.role}</div>
                            <div style={{ fontSize: 10.5, color: C.mute }}>{sr.client}</div>
                          </button>
                          <select value={stageFor(c, sid)} onChange={(e) => onStage(c.id, e.target.value, sid)}
                            style={{ fontSize: 10.5, padding: '3px 4px', border: `1px solid ${C.line}`, background: '#fff', color: st.color, fontWeight: 700 }}>
                            {STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                          <button title="Remove from this search" onClick={() => onRemoveFromSearch(c.id, sid)}
                            style={{ cursor: 'pointer', color: C.mute, padding: 2 }}><X size={12} /></button>
                        </div>
                        <div className="flex items-center gap-2" style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${C.lineSoft}` }}>
                          <span style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.mute, fontWeight: 600, flexShrink: 0 }}>
                            Interview
                          </span>
                          <input type="date"
                            value={(interviewFor(c, sid) || {}).date || ''}
                            onChange={(e) => onInterview(c.id, sid, { date: e.target.value })}
                            style={{ fontSize: 11, padding: '3px 5px', border: `1px solid ${C.line}`, background: '#fff', color: C.ink, flex: 1, minWidth: 0 }} />
                          <select
                            value={(interviewFor(c, sid) || {}).round || 'First round'}
                            onChange={(e) => onInterview(c.id, sid, { round: e.target.value })}
                            style={{ fontSize: 10.5, padding: '3px 4px', border: `1px solid ${C.line}`, background: '#fff', color: C.mute }}>
                            {ROUNDS.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <RelatedList title="Companies" empty="No company, because no search is assigned."
              items={Array.from(new Set(searchIdsOf(c).map((sid) => nav.searchById[sid]?.clientId).filter(Boolean))).map((clid) => ({
                key: clid,
                label: nav.clientById[clid]?.name || 'Company',
                sub: nav.clientById[clid]?.type,
                onClick: () => nav.goTo('client', clid),
              }))} />
            <RelatedList title="Client contacts" empty="No contacts on this account yet."
              items={nav.rel.contactsForCandidate(c).map((ct) => ({
                key: ct.id, label: ct.name, sub: ct.role || ct.title,
                onClick: () => nav.goTo('contact', ct.id),
              }))} />
          </div>
        </div>

        {/* tags */}
        <div style={{ padding: '12px 18px', background: C.card, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 9.5, letterSpacing: 0.9, textTransform: 'uppercase', color: C.mute, fontWeight: 800, marginBottom: 7 }}>Function tags</div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = (c.functionTags || []).includes(t);
              return <Pill key={t} color={tagColor(tags, t)} filled={on} onClick={() => toggleTag(t)}>{t}</Pill>;
            })}
          </div>
        </div>

        {/* tabs */}
        <div className="flex" style={{ background: C.card, borderBottom: `1px solid ${C.line}` }}>
          {[{ id: 'notes', l: 'Notes' }, { id: 'resume', l: 'Resume' }, { id: 'details', l: 'Edit profile' }].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '9px 15px', fontSize: 11, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase', cursor: 'pointer',
                color: C.brass, opacity: tab === t.id ? 1 : 0.6, borderBottom: `2px solid ${tab === t.id ? C.brass : 'transparent'}` }}>
              {t.l}
            </button>
          ))}
        </div>

        <div style={{ padding: 18, flex: 1 }}>
          {tab === 'notes' && (
            <div>
              <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened on this candidate?" />
              <div className="flex justify-end" style={{ marginTop: 8 }}>
                <Btn size="sm" onClick={postNote} disabled={!note.trim()}>Add note</Btn>
              </div>
              <div style={{ marginTop: 16 }}>
                {(c.notes || []).length === 0 && <Quiet>No notes on this candidate yet.</Quiet>}
                {[...(c.notes || [])].reverse().map((n) => (
                  <div key={n.id} style={{ padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
                      <Circle size={6} style={{ color: n.kind === 'system' ? C.mute : C.brass, fill: n.kind === 'system' ? C.mute : C.brass }} />
                      <span style={{ fontSize: 10.5, color: C.mute, letterSpacing: 0.4 }}>
                        {new Date(n.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: n.kind === 'system' ? C.mute : C.ink, fontStyle: n.kind === 'system' ? 'italic' : 'normal' }}>{n.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'resume' && (
            <div className="flex flex-col gap-3">
              <Dropzone
                multiple={false}
                compact
                onFiles={attachCV}
                label={cvFile ? 'Drop a newer CV to replace' : 'Drop a CV to fill this record'}
                hint="Blank fields are filled from the document. Anything you already typed stays as it is."
              />
              {cvStatus && (
                <div className="flex items-center gap-2" style={{ fontSize: 11.5, color: cvStatus.kind === 'error' ? C.red : cvStatus.kind === 'busy' ? C.brass : C.green }}>
                  {cvStatus.kind === 'busy' ? <Loader2 size={12} className="animate-spin" /> : cvStatus.kind === 'error' ? <AlertCircle size={12} /> : <Check size={12} />}
                  {cvStatus.msg}
                </div>
              )}
              {cvFile && (
                <div className="flex items-center justify-between gap-2" style={{ border: `1px solid ${C.line}`, background: C.card, padding: '9px 11px' }}>
                  <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                    <Paperclip size={13} style={{ color: C.brass, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cvFile.name}</span>
                  </div>
                  <Btn size="sm" kind="ghost" onClick={() => downloadCVFile(cvFile)}><Download size={12} /> Download</Btn>
                </div>
              )}
              <Field label="Resume link (Drive, Dropbox, LinkedIn PDF)">
                <TextInput value={c.resumeLink || ''} onChange={(e) => onPatch(c.id, { resumeLink: e.target.value })} placeholder="https://" />
              </Field>
              {c.resumeLink && (
                <a href={c.resumeLink} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>
                  <ExternalLink size={12} /> Open resume
                </a>
              )}
              <Field label="Resume text (paste the full document to keep it searchable)">
                {resumeLoaded ? (
                  <TextArea rows={14} value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste resume contents here" style={{ fontSize: 12 }} />
                ) : (
                  <div style={{ fontSize: 12, color: C.mute, padding: 10 }}>Loading</div>
                )}
              </Field>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 11, color: C.mute }}>{resume.length.toLocaleString()} characters</span>
                <Btn size="sm" onClick={saveResume} disabled={!resumeLoaded || resumeSaving}>
                  {resumeSaving ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Save resume
                </Btn>
              </div>
            </div>
          )}

          {tab === 'details' && (
            <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ gridColumn: 'span 2', fontSize: 11.5, color: C.mute, lineHeight: 1.6, paddingBottom: 4 }}>
                Every field below is editable and saves as you type.
              </div>
              <Field label="Name" span={2}><TextInput value={c.name || ''} onChange={(e) => onPatch(c.id, { name: e.target.value })} /></Field>
              <Field label="Title"><TextInput value={c.title || ''} onChange={(e) => onPatch(c.id, { title: e.target.value })} /></Field>
              <Field label="Company"><TextInput value={c.company || ''} onChange={(e) => onPatch(c.id, { company: e.target.value })} /></Field>
              <Field label="Email"><TextInput value={c.email || ''} onChange={(e) => onPatch(c.id, { email: e.target.value })} /></Field>
              <Field label="Phone"><TextInput value={c.phone || ''} onChange={(e) => onPatch(c.id, { phone: e.target.value })} /></Field>
              <Field label="LinkedIn" span={2}><TextInput value={c.linkedin || ''} onChange={(e) => onPatch(c.id, { linkedin: e.target.value })} /></Field>
              <Field label="Location"><TextInput value={c.location || ''} onChange={(e) => onPatch(c.id, { location: e.target.value })} /></Field>
              <Field label="Source"><TextInput value={c.source || ''} onChange={(e) => onPatch(c.id, { source: e.target.value })} placeholder="Referral, LinkedIn, inbound" /></Field>
              <Field label="Add to a search" span={2}>
                <Select value="" onChange={(e) => e.target.value && onAddToSearch([c.id], e.target.value)}>
                  <option value="">Pick a search to add</option>
                  {searches.filter((s) => !searchIdsOf(c).includes(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>{s.client} - {s.role}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Owner">
                <Select value={c.owner || ''} onChange={(e) => onPatch(c.id, { owner: e.target.value })}>
                  <option value="">Unassigned</option>
                  {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
              <Field label="Current comp"><TextInput value={c.compCurrent || ''} onChange={(e) => onPatch(c.id, { compCurrent: e.target.value })} placeholder="$250K + 30%" /></Field>
              <Field label="Target comp"><TextInput value={c.compTarget || ''} onChange={(e) => onPatch(c.id, { compTarget: e.target.value })} /></Field>
              <Field label="Next step" span={2}><TextInput value={c.nextStep || ''} onChange={(e) => onPatch(c.id, { nextStep: e.target.value })} placeholder="Send calibration notes to client" /></Field>
              <Field label="Next step date" span={2}>
                <TextInput type="date" value={c.nextStepDate ? c.nextStepDate.slice(0, 10) : ''} onChange={(e) => onPatch(c.id, { nextStepDate: e.target.value })} />
              </Field>
              <div style={{ gridColumn: 'span 2', marginTop: 8, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                {confirmDel ? (
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, color: C.red }}>Delete this candidate and their notes?</span>
                    <Btn size="sm" kind="danger" onClick={() => onDelete(c.id)}>Delete</Btn>
                    <Btn size="sm" kind="ghost" onClick={() => setConfirmDel(false)}>Keep</Btn>
                  </div>
                ) : (
                  <Btn size="sm" kind="danger" onClick={() => setConfirmDel(true)}><Trash2 size={12} /> Delete candidate</Btn>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FORMS
   ============================================================ */
function CandidateForm({ tags, searches, owners, onClose, onSave }) {
  const [f, setF] = useState({
    id: uid('c'), name: '', title: '', company: '', email: '', phone: '', linkedin: '', location: '',
    functionTags: [], searchIds: [], stages: {}, stage: 'identified', owner: owners[0] || '', source: '',
    compCurrent: '', compTarget: '', resumeLink: '', nextStep: '', nextStepDate: '',
    lastContactAt: nowISO(), notes: [],
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (t) => set('functionTags', f.functionTags.includes(t) ? f.functionTags.filter((x) => x !== t) : [...f.functionTags, t]);

  return (
    <Modal title="Add candidate" onClose={onClose} wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Field label="Full name"><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Required" /></Field>
        <Field label="Title"><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Company"><TextInput value={f.company} onChange={(e) => set('company', e.target.value)} /></Field>
        <Field label="Location"><TextInput value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Email"><TextInput value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><TextInput value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="LinkedIn"><TextInput value={f.linkedin} onChange={(e) => set('linkedin', e.target.value)} /></Field>
        <Field label="Resume link"><TextInput value={f.resumeLink} onChange={(e) => set('resumeLink', e.target.value)} /></Field>
        <Field label="Search">
          <Select value={f.searchIds[0] || ''} onChange={(e) => setF((p) => ({ ...p, searchIds: e.target.value ? [e.target.value] : [], stages: e.target.value ? { [e.target.value]: p.stage } : {} }))}>
            <option value="">Unassigned</option>
            {searches.map((s) => <option key={s.id} value={s.id}>{s.client} - {s.role}</option>)}
          </Select>
        </Field>
        <Field label="Stage">
          <Select value={f.stage} onChange={(e) => set('stage', e.target.value)}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={f.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </Field>
        <Field label="Source"><TextInput value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.mute, fontWeight: 700, marginBottom: 7 }}>Function tags</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <Pill key={t} color={tagColor(tags, t)} filled={f.functionTags.includes(t)} onClick={() => toggle(t)}>{t}</Pill>)}
        </div>
      </div>
      <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(f)} disabled={!f.name.trim()}>Save candidate</Btn>
      </div>
    </Modal>
  );
}

function SearchForm({ record, tags, clients, owners, contacts, onClose, onSave }) {
  const [f, setF] = useState(
    record || { id: uid('s'), client: '', clientId: '', role: '', functionTags: [], contactIds: [], status: 'Active', owner: owners[0] || '', fee: '', startDate: new Date().toISOString().slice(0, 10), targetDate: '', notes: '' }
  );
  const [nc, setNc] = useState({ name: '', title: '', email: '', phone: '' });
  const [newCo, setNewCo] = useState('');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    let out = { ...f };
    let created = null;
    const typed = newCo.trim();
    if (!out.clientId && typed) {
      // reuse a company of the same name rather than making a duplicate
      const existing = clients.find((c) => (c.name || '').toLowerCase() === typed.toLowerCase());
      if (existing) {
        out = { ...out, clientId: existing.id, client: existing.name };
      } else {
        created = { id: uid('cl'), name: typed, type: 'Direct', status: 'Active', notes: '' };
        out = { ...out, clientId: created.id, client: created.name };
      }
    } else if (out.clientId) {
      out = { ...out, client: clients.find((c) => c.id === out.clientId)?.name || out.client };
    }

    let newContact = null;
    if (nc.name.trim()) {
      newContact = {
        id: uid('ct'), name: nc.name.trim(), title: nc.title.trim(), clientId: out.clientId,
        email: nc.email.trim(), phone: nc.phone.trim(), mobile: '', linkedin: '', location: '',
        role: 'Decision Maker', status: 'Active', owner: out.owner || '', source: `Added on ${out.role}`,
        nextStep: '', nextStepDate: '', lastContactAt: nowISO(), notes: [],
      };
      out = { ...out, contactIds: [...(out.contactIds || []), newContact.id] };
    }
    onSave(out, created, newContact);
  };
  const canSave = (!!f.clientId || !!newCo.trim()) && !!f.role.trim();
  const coContacts = (contacts || []).filter((ct) => ct.clientId && ct.clientId === f.clientId);
  const toggleContact = (id) => setF((p) => {
    const cur = p.contactIds || [];
    return { ...p, contactIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });
  const toggle = (t) => set('functionTags', (f.functionTags || []).includes(t) ? f.functionTags.filter((x) => x !== t) : [...(f.functionTags || []), t]);

  return (
    <Modal title={record ? 'Edit search' : 'Add search'} onClose={onClose}>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Company" span={2}>
          <Select value={f.clientId} onChange={(e) => { set('clientId', e.target.value); if (e.target.value) setNewCo(''); }}>
            <option value="">Select a company</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!f.clientId && (
          <Field label="Or type a new company" span={2}>
            <TextInput value={newCo} onChange={(e) => setNewCo(e.target.value)} placeholder="Company name" />
            <span style={{ fontSize: 11, color: C.mute, marginTop: 5, lineHeight: 1.5 }}>
              Saving the search creates this company too, so you never enter it twice.
            </span>
          </Field>
        )}
        <Field label="Role" span={2}><TextInput value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="Chief Revenue Officer" /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['Active', 'On Hold', 'Business Development', 'Closed'].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={f.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
        <Field label="Opened"><TextInput type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Target close"><TextInput type="date" value={f.targetDate || ''} onChange={(e) => set('targetDate', e.target.value)} /></Field>
        <Field label="Fee" span={2}><TextInput value={f.fee} onChange={(e) => set('fee', e.target.value)} placeholder="$120K retained, three installments" /></Field>
        <Field label="Notes" span={2}><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.mute, fontWeight: 700, marginBottom: 7 }}>Function tags</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <Pill key={t} color={tagColor(tags, t)} filled={(f.functionTags || []).includes(t)} onClick={() => toggle(t)}>{t}</Pill>)}
        </div>
      </div>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
        <Eyebrow style={{ marginBottom: 9 }}>Client contacts on this search</Eyebrow>

        {coContacts.length > 0 && (
          <div style={{ border: `1px solid ${C.lineSoft}`, marginBottom: 12, maxHeight: 170, overflowY: 'auto' }}>
            {coContacts.map((ct) => {
              const on = (f.contactIds || []).includes(ct.id);
              return (
                <div key={ct.id} onClick={() => toggleContact(ct.id)} className="flex items-center gap-3"
                  style={{ padding: '8px 11px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer', background: on ? C.brassSoft : C.card }}>
                  <input type="checkbox" checked={on} readOnly />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ct.name}</div>
                    <div style={{ fontSize: 11, color: C.mute }}>
                      {[ct.title, ct.email, ct.phone].filter(Boolean).join(' · ') || 'No details on file'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {f.clientId && coContacts.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.mute, marginBottom: 12, lineHeight: 1.55 }}>
            No contacts on this company yet. Add one below and it appears on the Contacts page too.
          </div>
        )}

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Field label="New contact name"><TextInput value={nc.name} onChange={(e) => setNc((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Title"><TextInput value={nc.title} onChange={(e) => setNc((p) => ({ ...p, title: e.target.value }))} /></Field>
          <Field label="Email"><TextInput value={nc.email} onChange={(e) => setNc((p) => ({ ...p, email: e.target.value }))} /></Field>
          <Field label="Phone"><TextInput value={nc.phone} onChange={(e) => setNc((p) => ({ ...p, phone: e.target.value }))} /></Field>
        </div>
        {nc.name.trim() && (
          <div style={{ fontSize: 11, color: C.mute, marginTop: 7, lineHeight: 1.5 }}>
            Saving adds {nc.name.trim()} to this search and to Contacts, filed under the company.
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={!canSave}>Save search</Btn>
      </div>
    </Modal>
  );
}

/* ============================================================
   VIEW: CONTACTS
   ============================================================ */
const CONTACT_ROLES = ['Decision Maker', 'Economic Buyer', 'Champion', 'Influencer', 'Gatekeeper', 'Referral Source'];
const CONTACT_STATUS = ['Prospect', 'Active', 'Warm', 'Dormant'];

function ContactsView({ contacts, clients, onAdd, onEdit }) {
  const [q, setQ] = useState('');
  const [fClient, setFClient] = useState('');
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (fClient && c.clientId !== fClient) return false;
      if (!n) return true;
      return [c.name, c.title, c.email, c.phone, c.location, clientById[c.clientId]?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(n);
    });
  }, [contacts, q, fClient, clientById]);

  if (!contacts.length) {
    return <Empty icon={Mail} title="No contacts yet"
      hint="Everyone you deal with on the client side lives here: sponsors, operating partners, CHROs, board members. Each one carries their own notes and follow-up date."
      action={<Btn onClick={onAdd}><Plus size={13} /> Add a contact</Btn>} />;
  }

  return (
    <div>
      <SectionHead eyebrow="The relationships" title="Client contacts"
        action={<Btn size="sm" onClick={onAdd}><Plus size={12} /> Add contact</Btn>} />
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 14 }}>
        <div className="flex items-center gap-2" style={{ border: `1px solid ${C.line}`, padding: '5px 8px', background: '#fff', minWidth: 190, flex: '1 1 190px', maxWidth: 300 }}>
          <SearchIcon size={13} style={{ color: C.mute }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts"
            style={{ border: 'none', outline: 'none', fontSize: 12.5, width: '100%', fontFamily: SANS }} />
        </div>
        <Select value={fClient} onChange={(e) => setFClient(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="">All companies</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <span style={{ fontSize: 11.5, color: C.mute, marginLeft: 'auto' }}>{rows.length} shown</span>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' }}>
        {rows.map((c) => {
          const age = daysSince(c.lastContactAt);
          const statusColor = c.status === 'Active' ? C.green : c.status === 'Warm' ? C.brass : c.status === 'Prospect' ? '#3F6C8A' : C.mute;
          return (
            <div key={c.id} onClick={() => onEdit(c)}
              style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${statusColor}`, padding: 14, cursor: 'pointer' }}>
              <div className="flex items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 16, color: C.green, lineHeight: 1.2 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{c.title}</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{clientById[c.clientId]?.name || 'No company'}</div>
                </div>
                {c.role && <Pill color={C.navy}>{c.role}</Pill>}
              </div>

              <div className="flex flex-col gap-1" style={{ marginTop: 10, fontSize: 11.5 }}>
                {c.email && <span className="flex items-center gap-1.5" style={{ color: C.green }}><Mail size={11} /> {c.email}</span>}
                {c.phone && <span className="flex items-center gap-1.5" style={{ color: C.mute }}><Phone size={11} /> {c.phone}</span>}
                {c.linkedin && <span className="flex items-center gap-1.5" style={{ color: C.mute }}><Linkedin size={11} /> LinkedIn on file</span>}
              </div>

              {c.nextStep && (
                <div style={{ fontSize: 11.5, color: C.mute, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.lineSoft}`, lineHeight: 1.5 }}>
                  <strong style={{ color: C.ink }}>Next:</strong> {c.nextStep}
                  {c.nextStepDate && <span style={{ color: C.brass, fontWeight: 700 }}> · {fmtDate(c.nextStepDate)}</span>}
                </div>
              )}

              <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
                <Pill color={statusColor}>{c.status}</Pill>
                <span style={{ fontSize: 10.5, color: age >= 30 ? C.red : age >= 14 ? C.brass : C.mute }}>
                  {age === null ? 'No contact logged' : `${age}d since contact`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssignCandidates({ search, candidates, searchById, tags, onClose, onAssign, onCreate }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const [preview, setPreview] = useState(null);

  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = candidates.filter((c) => !searchIdsOf(c).includes(search.id));
    if (!needle) return pool.slice(0, 25);
    return pool
      .filter((c) => [c.name, c.title, c.company].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .slice(0, 25);
  }, [candidates, needle, search.id]);

  const already = candidates.filter((c) => searchIdsOf(c).includes(search.id)).length;
  const exactHit = candidates.some((c) => (c.name || '').toLowerCase() === needle);
  const toggle = (id) => {
    setPreview(id);
    setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  // as soon as the typing narrows to one person, show them
  useEffect(() => {
    if (matches.length === 1) setPreview(matches[0].id);
    else if (needle && !matches.some((m) => m.id === preview)) setPreview(null);
  }, [matches, needle, preview]);

  const shown = candidates.find((c) => c.id === preview);

  return (
    <Modal title={`Add candidates to ${search.role}`} onClose={onClose} wide>
      <div style={{ marginBottom: 12 }}>
        <Eyebrow style={{ marginBottom: 5 }}>{search.client}</Eyebrow>
        <div style={{ fontSize: 12, color: C.mute, lineHeight: 1.6 }}>
          {already} already on this search. Start typing a name to find someone already in the system.
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ border: `1px solid ${C.line}`, padding: '7px 10px', background: '#fff' }}>
        <SearchIcon size={14} style={{ color: C.mute }} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a candidate name"
          style={{ border: 'none', outline: 'none', fontSize: 13, width: '100%', fontFamily: SANS }}
        />
      </div>

      <div className="flex gap-3" style={{ marginTop: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260, maxHeight: 360, overflowY: 'auto', border: `1px solid ${C.lineSoft}` }}>
          {matches.length === 0 && (
            <div style={{ padding: 16, fontSize: 12.5, color: C.mute, lineHeight: 1.6 }}>
              {needle ? 'Nobody in the ledger matches that.' : 'No unassigned candidates yet.'}
            </div>
          )}
          {matches.map((c) => {
            const on = sel.includes(c.id);
            const other = searchIdsOf(c).map((sid) => searchById[sid]).filter(Boolean);
            return (
              <div
                key={c.id}
                onClick={() => toggle(c.id)}
                onMouseEnter={() => setPreview(c.id)}
                className="flex items-center gap-3"
                style={{
                  padding: '9px 12px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer',
                  background: on ? C.brassSoft : preview === c.id ? C.greenSoft : C.card,
                }}
              >
                <input type="checkbox" checked={on} readOnly />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.mute }}>
                    {[c.title, c.company].filter(Boolean).join(' · ') || 'No title on file'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1" style={{ justifyContent: 'flex-end' }}>
                  {other.slice(0, 2).map((o) => <Pill key={o.id} color={C.brass}>{o.role}</Pill>)}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 240, border: `1px solid ${C.lineSoft}`, background: C.card, padding: 14, minHeight: 200 }}>
          {!shown ? (
            <div style={{ fontSize: 12, color: C.mute, lineHeight: 1.65 }}>
              Type a name. If they are already in the ledger their profile shows here before you add them.
            </div>
          ) : (
            <div>
              <Eyebrow style={{ marginBottom: 8 }}>In the ledger</Eyebrow>
              <Headline size={19} style={{ marginBottom: 3 }}>{shown.name}</Headline>
              <div style={{ fontSize: 12, color: C.mute, lineHeight: 1.5 }}>
                {[shown.title, shown.company].filter(Boolean).join(' · ') || 'No title on file'}
              </div>
              {shown.location && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{shown.location}</div>}

              <div className="flex flex-wrap gap-1" style={{ marginTop: 10 }}>
                {(shown.functionTags || []).map((t) => <Pill key={t} color={tagColor(tags || [], t)}>{t}</Pill>)}
              </div>

              <div className="flex flex-col gap-1" style={{ marginTop: 11, fontSize: 11.5 }}>
                {shown.email && <span className="flex items-center gap-1.5" style={{ color: C.green }}><Mail size={11} /> {shown.email}</span>}
                {shown.phone && <span className="flex items-center gap-1.5" style={{ color: C.mute }}><Phone size={11} /> {shown.phone}</span>}
                {shown.linkedin && <span className="flex items-center gap-1.5" style={{ color: C.mute }}><Linkedin size={11} /> LinkedIn on file</span>}
                {(shown.resumeLink || shown.hasResumeText || shown.hasCvFile) &&
                  <span className="flex items-center gap-1.5" style={{ color: C.mute }}><FileText size={11} /> Resume on file</span>}
              </div>

              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.lineSoft}` }}>
                <Eyebrow color={C.mute} style={{ marginBottom: 6 }}>Already running in</Eyebrow>
                {searchIdsOf(shown).length === 0 ? (
                  <div style={{ fontSize: 11.5, color: C.mute }}>No other searches.</div>
                ) : (
                  searchIdsOf(shown).map((sid) => (
                    <div key={sid} className="flex items-center justify-between gap-2" style={{ fontSize: 11.5, padding: '3px 0' }}>
                      <span style={{ fontWeight: 600 }}>{searchById[sid]?.role || 'Search'}</span>
                      <span style={{ color: stageOf(stageFor(shown, sid)).color, fontWeight: 600 }}>
                        {stageOf(stageFor(shown, sid)).label}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 11, fontSize: 11, color: C.mute }}>
                {(shown.notes || []).length} notes · last contact {fmtDate(shown.lastContactAt || shown.updatedAt)}
              </div>
            </div>
          )}
        </div>
      </div>

      {needle && !exactHit && (
        <div style={{ marginTop: 12, padding: '11px 13px', border: `1px dashed ${C.line}`, background: C.card }}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 8, lineHeight: 1.55 }}>
            Not in the system yet?
          </div>
          <Btn size="sm" kind="ghost" onClick={() => onCreate(q.trim())}>
            <Plus size={12} /> Create "{q.trim()}" on this search
          </Btn>
        </div>
      )}

      <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
        <span style={{ fontSize: 11.5, color: C.mute }}>{sel.length} selected</span>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onAssign(sel)} disabled={!sel.length}>Add {sel.length || ''} to search</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ContactForm({ record, clients, owners, nav, onClose, onSave, onDelete }) {
  const [f, setF] = useState(
    record || {
      id: uid('ct'), name: '', title: '', clientId: '', email: '', phone: '', mobile: '',
      linkedin: '', location: '', role: '', status: 'Prospect', owner: owners[0] || '',
      source: '', nextStep: '', nextStepDate: '', lastContactAt: '', notes: [],
    }
  );
  const [note, setNote] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const addNote = () => {
    if (!note.trim()) return;
    setF((p) => ({
      ...p,
      lastContactAt: nowISO(),
      notes: [...(p.notes || []), { id: uid('n'), ts: nowISO(), kind: 'note', body: note.trim() }],
    }));
    setNote('');
  };

  return (
    <Modal title={record ? 'Contact' : 'Add contact'} onClose={onClose} wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Field label="Full name"><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Required" /></Field>
        <Field label="Title"><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Company">
          <Select value={f.clientId} onChange={(e) => set('clientId', e.target.value)}>
            <option value="">Unassigned</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Role in the deal">
          <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="">Not set</option>
            {CONTACT_ROLES.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Email"><TextInput value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Direct line"><TextInput value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Mobile"><TextInput value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <Field label="LinkedIn"><TextInput value={f.linkedin} onChange={(e) => set('linkedin', e.target.value)} /></Field>
        <Field label="Location"><TextInput value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {CONTACT_STATUS.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={f.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
        <Field label="How you met"><TextInput value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Referral, conference, inbound" /></Field>
        <Field label="Next step"><TextInput value={f.nextStep} onChange={(e) => set('nextStep', e.target.value)} placeholder="Send the Meridian shortlist" /></Field>
        <Field label="Next step date">
          <TextInput type="date" value={f.nextStepDate ? f.nextStepDate.slice(0, 10) : ''} onChange={(e) => set('nextStepDate', e.target.value)} />
        </Field>
      </div>

      {f.clientId && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <RelatedList title="Company" empty="No company linked."
            items={nav.clientById[f.clientId] ? [{
              key: f.clientId, label: nav.clientById[f.clientId].name, sub: nav.clientById[f.clientId].type,
              onClick: () => nav.goTo('client', f.clientId),
            }] : []} />
          <RelatedList title="Searches at this company" empty="No searches on this account."
            items={nav.rel.searchesOfClient(f.clientId).map((sr) => ({
              key: sr.id, label: sr.role, sub: sr.status, onClick: () => nav.goTo('search', sr.id),
            }))} />
          <RelatedList title="Candidates in play" empty="No candidates against this company yet."
            items={nav.rel.candidatesOfClient(f.clientId).slice(0, 8).map((cd) => ({
              key: cd.id, label: cd.name, sub: stageOf(cd.stage).label, onClick: () => nav.goTo('candidate', cd.id),
            }))} />
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.mute, fontWeight: 700, marginBottom: 7 }}>
          Notes
        </div>
        <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What came out of the last conversation?" />
        <div className="flex justify-end" style={{ marginTop: 7 }}>
          <Btn size="sm" kind="ghost" onClick={addNote} disabled={!note.trim()}>Add note</Btn>
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
          {(f.notes || []).length === 0 && <Quiet>No notes on this contact yet.</Quiet>}
          {[...(f.notes || [])].reverse().map((n) => (
            <div key={n.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
              <div style={{ fontSize: 10.5, color: C.mute, marginBottom: 3 }}>
                {new Date(n.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{n.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
        <div>
          {record && (confirmDel ? (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 12, color: C.red }}>Delete this contact?</span>
              <Btn size="sm" kind="danger" onClick={() => onDelete(f.id)}>Delete</Btn>
              <Btn size="sm" kind="ghost" onClick={() => setConfirmDel(false)}>Keep</Btn>
            </div>
          ) : (
            <Btn size="sm" kind="danger" onClick={() => setConfirmDel(true)}><Trash2 size={12} /> Delete</Btn>
          ))}
        </div>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)} disabled={!f.name.trim()}>Save contact</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ClientForm({ record, nav, onClose, onSave }) {
  const [f, setF] = useState(record || { id: uid('cl'), name: '', type: 'Direct', contactName: '', contactTitle: '', email: '', phone: '', status: 'Prospect', notes: '' });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={record ? 'Edit client' : 'Add client'} onClose={onClose}>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Client name" span={2}><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
            {['PE Sponsor', 'Portfolio Company', 'Direct', 'Professional Services'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['Prospect', 'Active', 'Past'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Notes" span={2}><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div style={{ gridColumn: 'span 2', fontSize: 11.5, color: C.mute, lineHeight: 1.6 }}>
          People at this company are kept under Contacts, not here, so nothing is entered twice.
        </div>
      </div>

      {record && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <RelatedList title="Searches" empty="No searches on this account."
            items={nav.rel.searchesOfClient(f.id).map((sr) => ({
              key: sr.id, label: sr.role, sub: sr.status, onClick: () => nav.goTo('search', sr.id),
            }))} />
          <RelatedList title="Contacts" empty="No contacts yet."
            items={nav.rel.contactsOfClient(f.id).map((ct) => ({
              key: ct.id, label: ct.name, sub: ct.role || ct.title, onClick: () => nav.goTo('contact', ct.id),
            }))} />
          <RelatedList title="Candidates" empty="No candidates against this company yet."
            items={nav.rel.candidatesOfClient(f.id).slice(0, 10).map((cd) => ({
              key: cd.id, label: cd.name, sub: stageOf(cd.stage).label, onClick: () => nav.goTo('candidate', cd.id),
            }))} />
        </div>
      )}

      <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(f)} disabled={!f.name.trim()}>Save company</Btn>
      </div>
    </Modal>
  );
}

function BulkAdd({ tags, searches, owners, onClose, onSave }) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [searchId, setSearchId] = useState('');
  const [owner, setOwner] = useState(owners[0] || '');

  const parsed = useMemo(() =>
    text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, title, company] = l.split(',').map((x) => (x || '').trim());
      return { name, title, company };
    }).filter((r) => r.name), [text]);

  const commit = () =>
    onSave(parsed.map((r) => ({
      id: uid('c'), name: r.name, title: r.title || '', company: r.company || '',
      email: '', phone: '', linkedin: '', location: '', functionTags: tag ? [tag] : [],
      searchIds: searchId ? [searchId] : [], stages: searchId ? { [searchId]: 'identified' } : {},
      stage: 'identified', owner, source: 'Bulk add', compCurrent: '', compTarget: '',
      resumeLink: '', nextStep: '', nextStepDate: '', lastContactAt: nowISO(),
      createdAt: nowISO(), updatedAt: nowISO(), notes: [],
    })));

  return (
    <Modal title="Paste a candidate list" onClose={onClose}>
      <div style={{ fontSize: 12, color: C.mute, lineHeight: 1.6, marginBottom: 10 }}>
        One person per line, comma separated: <strong style={{ color: C.ink }}>Name, Title, Company</strong>. Title and company are optional.
      </div>
      <TextArea rows={9} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'Dana Ruiz, VP Sales, Northwind\nSam Okafor, Head of AI, Lattice Labs'} />
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
        <Field label="Apply function tag">
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">None</option>
            {tags.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Assign to search">
          <Select value={searchId} onChange={(e) => setSearchId(e.target.value)}>
            <option value="">Unassigned</option>
            {searches.map((s) => <option key={s.id} value={s.id}>{s.client} - {s.role}</option>)}
          </Select>
        </Field>
        <Field label="Owner" span={2}>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-between" style={{ marginTop: 16 }}>
        <span style={{ fontSize: 12, color: C.mute }}>{parsed.length} candidates ready</span>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={commit} disabled={!parsed.length}>Add {parsed.length || ''}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   CV DROPZONE + IMPORT
   ============================================================ */
function Dropzone({ onFiles, multiple = true, compact, label, hint }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const take = (list) => {
    const arr = Array.from(list || []);
    if (arr.length) onFiles(multiple ? arr : [arr[0]]);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      onClick={() => inputRef.current && inputRef.current.click()}
      style={{
        border: `1.5px dashed ${over ? C.brass : C.line}`,
        background: over ? C.brassSoft : C.card,
        padding: compact ? '16px 14px' : '32px 20px',
        textAlign: 'center',
        cursor: 'pointer',
      }}
    >
      <input
        ref={inputRef} type="file" multiple={multiple}
        accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
        style={{ display: 'none' }}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
      <UploadCloud size={compact ? 18 : 26} style={{ color: over ? C.brass : C.green, margin: '0 auto 8px' }} />
      <div style={{ fontFamily: SERIF, fontSize: compact ? 13.5 : 16, color: C.green }}>
        {label || 'Drop CVs here'}
      </div>
      <div style={{ fontSize: 11.5, color: C.mute, marginTop: 4, lineHeight: 1.55 }}>
        {hint || 'PDF, DOCX, TXT, or a photo. Click to browse.'}
      </div>
    </div>
  );
}

function CVImport({ tags, searches, owners, onClose, onCommit }) {
  const [jobs, setJobs] = useState([]);
  const [searchId, setSearchId] = useState('');
  const [owner, setOwner] = useState(owners[0] || '');
  const [stage, setStage] = useState('identified');
  const [committing, setCommitting] = useState(false);
  const running = useRef(false);

  const addFiles = (files) => {
    setJobs((prev) => [
      ...prev,
      ...files.map((f) => ({ id: uid('j'), file: f, status: 'queued', error: null, parsed: null, include: true })),
    ]);
  };

  // parse queued files one at a time
  useEffect(() => {
    if (running.current) return;
    const next = jobs.find((j) => j.status === 'queued');
    if (!next) return;
    running.current = true;
    const set = (patch) => setJobs((prev) => prev.map((j) => (j.id === next.id ? { ...j, ...patch } : j)));
    set({ status: 'reading' });
    (async () => {
      try {
        const parsed = await parseCV(next.file, tags);
        set({ status: 'done', parsed });
      } catch (e) {
        set({ status: 'error', error: e.message || 'Could not read that file.' });
      }
      running.current = false;
      setJobs((prev) => [...prev]); // nudge the queue
    })();
  }, [jobs, tags]);

  const ready = jobs.filter((j) => j.status === 'done' && j.include);
  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'reading');

  const editParsed = (id, key, val) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, parsed: { ...j.parsed, [key]: val } } : j)));

  const toggleTag = (id, t) =>
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        const cur = j.parsed.functionTags || [];
        return { ...j, parsed: { ...j.parsed, functionTags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] } };
      })
    );

  const commit = async () => {
    setCommitting(true);
    const items = [];
    for (const j of ready) {
      const p = j.parsed;
      const id = uid('c');
      const cvFile = await packCVFile(j.file).catch(() => null);
      const notes = [];
      if (p.summary) notes.push({ id: uid('n'), ts: nowISO(), kind: 'note', body: p.summary });
      if (p.highlights?.length) notes.push({ id: uid('n'), ts: nowISO(), kind: 'note', body: p.highlights.map((h) => `- ${h}`).join('\n') });
      notes.push({ id: uid('n'), ts: nowISO(), kind: 'system', body: `Added from CV: ${j.file.name}` });
      items.push({
        candidate: {
          id, name: p.name || j.file.name.replace(/\.[^.]+$/, ''), title: p.title || '', company: p.company || '',
          email: p.email || '', phone: p.phone || '', linkedin: p.linkedin || '', location: p.location || '',
          functionTags: p.functionTags || [], searchIds: searchId ? [searchId] : [],
          stages: searchId ? { [searchId]: stage } : {}, stage, owner,
          source: 'CV import', seniority: p.seniority || '', yearsExperience: p.yearsExperience || '',
          compCurrent: p.compCurrent || '', compTarget: '', resumeLink: '',
          cvFileName: cvFile ? j.file.name : '', hasCvFile: !!cvFile, hasResumeText: true,
          nextStep: '', nextStepDate: '', lastContactAt: nowISO(),
          createdAt: nowISO(), updatedAt: nowISO(), notes,
        },
        resumeText: buildResumeText(p),
        cvFile,
      });
    }
    await onCommit(items);
    setCommitting(false);
  };

  const StatusChip = ({ j }) => {
    if (j.status === 'queued') return <span style={{ fontSize: 11, color: C.mute }}>Queued</span>;
    if (j.status === 'reading') return <span className="flex items-center gap-1" style={{ fontSize: 11, color: C.brass }}><Loader2 size={11} className="animate-spin" /> Reading</span>;
    if (j.status === 'error') return <span style={{ fontSize: 11, color: C.red }}>{j.error}</span>;
    return <span className="flex items-center gap-1" style={{ fontSize: 11, color: C.green }}><Check size={11} /> Parsed</span>;
  };

  return (
    <Modal title="Import CVs" onClose={onClose} wide>
      <Dropzone onFiles={addFiles} />

      {jobs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 14 }}>
            <Field label="Assign to search">
              <Select value={searchId} onChange={(e) => setSearchId(e.target.value)}>
                <option value="">Unassigned</option>
                {searches.map((s) => <option key={s.id} value={s.id}>{s.client} - {s.role}</option>)}
              </Select>
            </Field>
            <Field label="Owner">
              <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Unassigned</option>
                {owners.map((o) => <option key={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Starting stage">
              <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-2" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {jobs.map((j) => (
              <div key={j.id} style={{ border: `1px solid ${C.line}`, background: C.card, padding: 12, opacity: j.include ? 1 : 0.5 }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                    <Paperclip size={12} style={{ color: C.mute, flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.file.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip j={j} />
                    <button onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))} style={{ cursor: 'pointer', color: C.mute }}><X size={13} /></button>
                  </div>
                </div>

                {j.status === 'done' && j.parsed && (
                  <div style={{ marginTop: 10 }}>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                      <Field label="Name"><TextInput value={j.parsed.name || ''} onChange={(e) => editParsed(j.id, 'name', e.target.value)} /></Field>
                      <Field label="Title"><TextInput value={j.parsed.title || ''} onChange={(e) => editParsed(j.id, 'title', e.target.value)} /></Field>
                      <Field label="Company"><TextInput value={j.parsed.company || ''} onChange={(e) => editParsed(j.id, 'company', e.target.value)} /></Field>
                      <Field label="Email"><TextInput value={j.parsed.email || ''} onChange={(e) => editParsed(j.id, 'email', e.target.value)} /></Field>
                      <Field label="Phone"><TextInput value={j.parsed.phone || ''} onChange={(e) => editParsed(j.id, 'phone', e.target.value)} /></Field>
                      <Field label="Location"><TextInput value={j.parsed.location || ''} onChange={(e) => editParsed(j.id, 'location', e.target.value)} /></Field>
                    </div>
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
                      {tags.map((t) => (
                        <Pill key={t} color={tagColor(tags, t)} filled={(j.parsed.functionTags || []).includes(t)} onClick={() => toggleTag(j.id, t)}>{t}</Pill>
                      ))}
                    </div>
                    {j.parsed.summary && (
                      <div style={{ fontSize: 12, color: C.mute, lineHeight: 1.6, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.lineSoft}` }}>
                        {j.parsed.summary}
                      </div>
                    )}
                    <div className="flex items-center gap-3" style={{ marginTop: 9 }}>
                      <label className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: C.mute, cursor: 'pointer' }}>
                        <input type="checkbox" checked={j.include} onChange={(e) => setJobs((p) => p.map((x) => (x.id === j.id ? { ...x, include: e.target.checked } : x)))} />
                        Add this candidate
                      </label>
                      {j.parsed.seniority && <Pill color={C.navy}>{j.parsed.seniority}</Pill>}
                      {j.parsed.yearsExperience && <span style={{ fontSize: 11, color: C.mute }}>{j.parsed.yearsExperience} yrs</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
        <span style={{ fontSize: 11.5, color: C.mute }}>
          {busy ? 'Reading CVs' : `${ready.length} ready to add`}
        </span>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={onClose}>Close</Btn>
          <Btn onClick={commit} disabled={!ready.length || busy || committing}>
            {committing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add {ready.length || ''} candidates
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function SettingsForm({ meta, onClose, onSave }) {
  const [tags, setTags] = useState(meta.tags.join('\n'));
  const [owners, setOwners] = useState(meta.owners.join('\n'));
  return (
    <Modal title="Tags and team" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Function tags (one per line)">
          <TextArea rows={9} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Team members (one per line)">
          <TextArea rows={4} value={owners} onChange={(e) => setOwners(e.target.value)} />
        </Field>
        <div style={{ fontSize: 11.5, color: C.mute, lineHeight: 1.6 }}>
          Removing a tag here leaves it on any candidate already carrying it. Re-add the tag if you want it selectable again.
        </div>
      </div>
      <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave({
          tags: tags.split('\n').map((t) => t.trim()).filter(Boolean),
          owners: owners.split('\n').map((t) => t.trim()).filter(Boolean),
        })}>Save</Btn>
      </div>
    </Modal>
  );
}
