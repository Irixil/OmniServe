'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PUBLIC_CASES, type PublicCase } from '../lib/public-domain';
import { normalizeTimeZone } from '../lib/timezones';
import { TIME_ZONE_GROUPS } from '../lib/timezone-options';
import { VISUAL_LIBRARY } from '../lib/visual-library';
import PublicSiteNav from './public-site-nav';

type Citation = { document_id: string; title: string; category: string; updated_at?: string };
type DisplayCase = Omit<PublicCase, 'visibility' | 'rights_status' | 'rights_expires_at'> & { title?: string; description?: string; alt?: string; match_reason?: string };
type ChatAttachment = { id: string; message_id: string; mime_type: string; byte_size: number; status: string; content_url: string };
type Message = { id: string; sender: 'assistant' | 'customer' | 'human'; content: string; mode: string; citations: Citation[]; cases: DisplayCase[]; attachments: ChatAttachment[] };
type Session = { conversation_id: string; token: string };
type ChatResult = {
  conversation_id: string; message_id: string; locale: 'en'; mode: string; answer: string; citations: Citation[];
  cases?: DisplayCase[]; missing_fields?: string[]; conflicts?: string[]; handoff_status: string;
  accepted?: boolean; duplicate?: boolean; refresh?: boolean;
};
type PublicHttpError = Error & { status?: number };
type PendingClientMessage = { signature: string; id: string };
const OTHER_TIME_ZONE = '__other__';

function browserTimeZone() {
  try { return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return ''; }
}

const SESSION_KEY = 'archviz-public-conversation-v2';

const copy = {
    chatTitle: 'Start a project', chatSubtitle: 'Ask a question or tell us about your project', human: 'Automated assistance',
    placeholder: 'Ask a question or tell us about your project…', send: 'Send message', loading: 'Preparing a response…',
  privacy: 'You may attach one JPEG, PNG or WebP image up to 10 MB. For privacy, save a copy without embedded camera or location details before uploading.',
    prompts: ['What files should I prepare?', 'I need an architectural animation walkthrough', 'How do we define the visual direction?'],
    submit: 'Request a follow-up',
    leadTitle: 'Request a project follow-up', leadIntro: 'Your conversation will be shared with our project team so they can follow up. Our project team follows up daily between 10:00 and 22:00 Beijing time.',
    name: 'Name', organization: 'Organization', email: 'Business email', country: 'Country or region', timezone: 'Time zone', consent: 'I agree that the team may use these details to follow up on this enquiry.',
    leadSend: 'Send follow-up request', sent: 'Request sent', refresh: 'Refresh conversation', selected: 'Selected imagery', selectedIntro: 'Illustrative visual studies exploring building type, viewpoint, scale and atmosphere.',
    boundaries: 'Planning a project', can: 'Tell us about the project type, design stage, required views, atmosphere and timing. Our team will review your enquiry.',
    cannot: 'Pricing, scope, production programme and final feasibility are confirmed by a project director after review.',
    contact: 'Ready to begin?', contactText: 'Tell us what you are working on and request a follow-up from the studio.',
    caseLabel: 'Concept visualization', restart: 'New conversation',
} as const;

const SERVICES = [
  {
    title: 'Architectural still imagery',
    summary: 'Exterior, interior, landscape and aerial images with a precise point of view, believable material and controlled atmosphere.',
    tags: 'Competition · Planning · Marketing',
    detail: 'We define the image set around the decisions it needs to support: massing, arrival, façade, public realm, interior experience or campaign narrative.',
    includes: 'Shot list · camera studies · lighting direction · final-resolution image set',
  },
  {
    title: 'Architectural animation & walkthroughs',
    summary: 'Camera-led films that reveal arrival, movement, scale and the lived rhythm of a place from site to interior.',
    tags: 'Walkthrough · Fly-through · Teaser · Social edits',
    detail: 'The route is designed before production. We map camera height, speed, transitions, focal moments, people, landscape and sound so the sequence communicates architecture rather than simply orbiting it.',
    includes: 'Storyboard · animatic · camera blocking · environment animation · edit · grade · delivery masters',
  },
  {
    title: 'Visual direction',
    summary: 'Early image strategy, reference curation and shot planning that align the visual language before production.',
    tags: 'Viewpoints · Light · Material · Narrative',
    detail: 'A compact direction phase sets the visual thesis for the whole commission, giving every contributor a shared language for composition, season, atmosphere and human presence.',
    includes: 'Reference edit · visual thesis · shot priorities · review framework',
  },
  {
    title: 'Post-production & delivery',
    summary: 'Finishing, grading and compositing that make still and moving image sets feel consistent across every format.',
    tags: 'Retouching · Colour · Compositing · Delivery',
    detail: 'We refine hierarchy, material response, atmosphere and human presence, then prepare coordinated masters for presentation, print, web and campaign use.',
    includes: 'Retouching · colour grade · format versions · delivery package',
  },
] as const;

function normalizeMessage(item: Record<string, unknown>): Message {
  const attachments = Array.isArray(item.attachments) ? item.attachments as ChatAttachment[] : [];
  return {
    id: String(item.id ?? crypto.randomUUID()), sender: (item.sender === 'customer' || item.sender === 'human') ? item.sender : 'assistant',
    content: String(item.content ?? ''), mode: String(item.mode ?? 'grounded'),
    citations: Array.isArray(item.citations) ? item.citations as Citation[] : [], cases: Array.isArray(item.cases) ? item.cases as DisplayCase[] : [], attachments,
  };
}

function conceptAlt(value: string) {
  return `Concept visualization: ${value.replace(/^Sample /, '')}`;
}

function ProtectedAttachment({ attachment, token }: { attachment: ChatAttachment; token: string }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = '';
    let active = true;
    fetch(attachment.content_url, { headers: { 'x-conversation-token': token } })
      .then((response) => { if (!response.ok) throw new Error('Image unavailable'); return response.blob(); })
      .then((blob) => { const next = URL.createObjectURL(blob); if (active) { objectUrl = next; setSource(next); } else URL.revokeObjectURL(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.content_url, token]);
  return <figure className="chat-attachment">{source ? <Image src={source} width={480} height={320} unoptimized alt="Attached project image" /> : <span>{failed ? 'Image could not be loaded.' : 'Loading attached image…'}</span>}</figure>;
}

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const result = await fetch('/api/public/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await result.json().catch(() => ({})) as { error?: string };
  if (!result.ok) {
    const error = new Error(value.error || 'The request could not be completed.') as PublicHttpError;
    error.status = result.status;
    throw error;
  }
  return value as T;
}

export default function PublicConcierge() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [sendOutcomeUnknown, setSendOutcomeUnknown] = useState(false);
  const [pendingClientMessage, setPendingClientMessage] = useState<PendingClientMessage | null>(null);
  const [conversationEnded, setConversationEnded] = useState(false);
  const [removingAttachment, setRemovingAttachment] = useState(false);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState('ai');
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadSent, setLeadSent] = useState(false);
  const [timeZoneChoice, setTimeZoneChoice] = useState('');
  const [otherTimeZone, setOtherTimeZone] = useState('');
  const [galleryFilter, setGalleryFilter] = useState('All');
  const messageListRef = useRef<HTMLDivElement>(null);
  const t = copy;

  const galleryCases = galleryFilter === 'All' ? PUBLIC_CASES : PUBLIC_CASES.filter((item) => item.building_type === galleryFilter);

  const start = useCallback(async () => {
    setBusy(true); setError(''); setRestoreFailed(false); setConversationEnded(false); setSendOutcomeUnknown(false); setPendingClientMessage(null); setPendingAttachment(null);
    try {
      const detected = browserTimeZone();
      if (detected) setTimeZoneChoice(detected);
      const data = await request<{ conversation_id: string; token: string; status: string; message: Record<string, unknown> }>({ action: 'start', locale: 'en', ...(detected ? { client_timezone: detected } : {}) });
      const nextSession = { conversation_id: data.conversation_id, token: data.token };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession); setMessages([normalizeMessage({ ...data.message, id: 'welcome' })]); setHandoff(data.status); setLeadSent(false); setConversationEnded(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start the conversation.'); }
    finally { setBusy(false); }
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    const result = await fetch(`/api/public/chat?conversation_id=${encodeURIComponent(session.conversation_id)}`, { headers: { 'x-conversation-token': session.token } });
    if (!result.ok) {
      const error = new Error(result.status === 410 ? 'This conversation has ended. Start a new conversation to continue.' : 'Unable to refresh the conversation.') as PublicHttpError;
      error.status = result.status;
      if (result.status === 410) { setConversationEnded(true); setHandoff('closed'); setLeadOpen(false); setError(error.message); }
      throw error;
    }
    const data = await result.json() as { conversation: { status: string; client_timezone?: string }; messages: Record<string, unknown>[]; pending_attachments?: ChatAttachment[]; lead: unknown };
    setMessages(data.messages.map(normalizeMessage)); setPendingAttachment(data.pending_attachments?.[0] ?? null); setHandoff(data.conversation.status); setLeadSent(Boolean(data.lead));
    setTimeZoneChoice((current) => current || normalizeTimeZone(data.conversation.client_timezone) || browserTimeZone());
    setSendOutcomeUnknown(false);
    if (data.conversation.status === 'closed') { setConversationEnded(true); setLeadOpen(false); setError('This conversation has ended. Start a new conversation to continue.'); }
    return data;
  }, [session]);

  async function retryRestore() {
    if (!session || busy) return;
    setBusy(true); setRefreshing(true); setError('');
    try { await refresh(); setRestoreFailed(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to restore the saved conversation.'); }
    finally { setBusy(false); setRefreshing(false); }
  }

  useEffect(() => {
    localStorage.removeItem('archviz-public-conversation');
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Session;
        const load = async () => {
          try {
            const result = await fetch(`/api/public/chat?conversation_id=${encodeURIComponent(parsed.conversation_id)}`, { headers: { 'x-conversation-token': parsed.token } });
            if (result.status === 410) {
              setSession(parsed); setConversationEnded(true); setHandoff('closed'); setLeadOpen(false);
              setError('This conversation has ended. Start a new conversation to continue.');
              return;
            }
            if ([401, 404].includes(result.status)) {
              localStorage.removeItem(SESSION_KEY);
              await start();
              return;
            }
            if (!result.ok) throw new Error('We could not restore this conversation. Please try again.');
            const data = await result.json() as { conversation: { status: string; client_timezone?: string }; messages: Record<string, unknown>[]; pending_attachments?: ChatAttachment[]; lead: unknown };
            setSession(parsed); setRestoreFailed(false); setConversationEnded(false); setError(''); setHandoff(data.conversation.status); setMessages(data.messages.map(normalizeMessage)); setPendingAttachment(data.pending_attachments?.[0] ?? null); setLeadSent(Boolean(data.lead));
            setTimeZoneChoice(normalizeTimeZone(data.conversation.client_timezone) || browserTimeZone());
          } catch (cause) {
            setSession(parsed); setRestoreFailed(true);
            setError(cause instanceof Error ? `${cause.message} Your saved conversation is still on this device. Retry, or start a new conversation.` : 'The saved conversation could not be restored. Your saved conversation is still on this device. Retry, or start a new conversation.');
          }
        };
        load().finally(() => setBusy(false));
        return;
      } catch { localStorage.removeItem(SESSION_KEY); }
    }
    queueMicrotask(() => { start().finally(() => setBusy(false)); });
  }, [start]);
  useEffect(() => {
    const list = messageListRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: messages.length > 1 && !reduceMotion ? 'smooth' : 'auto' });
  }, [messages, busy]);
  useEffect(() => {
    if (!session || conversationEnded || !['requested', 'human', 'processing'].includes(handoff)) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        await refresh().catch(() => undefined);
      }
      timer = window.setTimeout(poll, 60000);
    };
    timer = window.setTimeout(poll, 12000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [session, handoff, conversationEnded, refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !pendingAttachment) || !session || busy || uploadBusy || restoreFailed) return;
    const signature = `${text}\u0000${pendingAttachment?.id ?? ''}`;
    const clientMessage = pendingClientMessage?.signature === signature
      ? pendingClientMessage
      : { signature, id: crypto.randomUUID() };
    setPendingClientMessage(clientMessage);
    const optimisticId = `local-${Date.now()}`;
    setMessages((items) => [...items, { id: optimisticId, sender: 'customer', content: text || 'Image attached.', mode: 'customer', citations: [], cases: [], attachments: pendingAttachment ? [pendingAttachment] : [] }]);
    setBusy(true); setError('');
    try {
      const data = await request<ChatResult>({ action: 'message', ...session, message: text, attachment_ids: pendingAttachment ? [pendingAttachment.id] : [], client_message_id: clientMessage.id, locale: 'en' });
      setInput('');
      setPendingAttachment(null);
      setPendingClientMessage(null);
      setSendOutcomeUnknown(false);
      setHandoff(data.handoff_status || handoff);
      if (data.duplicate && data.refresh) {
        try { await refresh(); }
        catch (refreshError) { setError(refreshError instanceof Error ? `Your message was received, but the conversation could not be refreshed. ${refreshError.message}` : 'Your message was received, but the conversation could not be refreshed.'); }
      } else if (data.answer) {
        setMessages((items) => [...items, { id: data.message_id, sender: 'assistant', content: data.answer, mode: data.mode || 'grounded', citations: data.citations || [], cases: data.cases || [], attachments: [] }]);
      }
    } catch (cause) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId));
      const status = (cause as PublicHttpError)?.status;
      if (status === 410) {
        setConversationEnded(true); setHandoff('closed');
        setError('This conversation has ended. Your text is still here; start a new conversation to continue.');
      } else if (status === 409) {
        try {
          const data = await refresh();
          setError(data?.conversation.status === 'closed'
            ? 'This conversation has ended. Your text is still here; start a new conversation to continue.'
            : data?.conversation.status === 'processing'
            ? 'A message is still being handled. Your text remains in the box; wait for the conversation to update before trying again.'
            : (cause instanceof Error ? cause.message : 'The conversation changed. Please review it and try again.'));
        } catch (refreshError) {
          setError(refreshError instanceof Error ? `${refreshError.message} Your text is still here.` : 'The conversation could not be refreshed. Your text is still here.');
        }
      } else if (status === undefined || status >= 500) {
        setSendOutcomeUnknown(true);
        setError('We could not confirm whether this message was received. Your text and image are still here. Refresh the conversation, or retry the same message safely.');
      } else {
        setError(cause instanceof Error ? `${cause.message} Your text is still here.` : 'Unable to send the message. Your text is still here.');
      }
    }
    finally { setBusy(false); }
  }

  async function uploadImage(file?: File) {
    if (!file || !session || uploadBusy || busy || restoreFailed) return;
    if (pendingAttachment) { setError('Remove the current image before attaching another.'); return; }
    setUploadBusy(true); setError('');
    try {
      const form = new FormData(); form.set('conversation_id', session.conversation_id); form.set('file', file);
      const response = await fetch('/api/public/chat/attachments', { method: 'POST', headers: { 'x-conversation-token': session.token }, body: form });
      const value = await response.json().catch(() => ({})) as { id?: string; status?: string; mime_type?: string; byte_size?: number; error?: string };
      if (!response.ok || !value.id) throw new Error(value.error || 'The image could not be uploaded.');
      setPendingAttachment({ id: value.id, message_id: '', mime_type: value.mime_type || file.type, byte_size: Number(value.byte_size || file.size), status: value.status || 'uploaded', content_url: `/api/public/chat/attachments/${value.id}?conversation_id=${encodeURIComponent(session.conversation_id)}` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The image could not be uploaded.'); }
    finally { setUploadBusy(false); }
  }

  async function removePendingAttachment() {
    if (!session || !pendingAttachment || busy || uploadBusy || removingAttachment) return;
    setRemovingAttachment(true); setError('');
    try {
      const url = `/api/public/chat/attachments/${encodeURIComponent(pendingAttachment.id)}?conversation_id=${encodeURIComponent(session.conversation_id)}`;
      const response = await fetch(url, { method: 'DELETE', headers: { 'x-conversation-token': session.token } });
      const value = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(value.error || 'The image could not be removed. Please try again.');
      setPendingAttachment(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be removed. Please try again.');
    } finally { setRemovingAttachment(false); }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || restoreFailed || conversationEnded) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const timezone = normalizeTimeZone(timeZoneChoice === OTHER_TIME_ZONE ? otherTimeZone : timeZoneChoice);
    if (!timezone) { setError('Choose a time zone or enter a valid IANA time zone, such as Europe/Paris.'); return; }
    delete values.timezone_choice;
    values.timezone = timezone;
    setBusy(true); setError('');
    try {
      const result = await request<{ handoff_status?: string }>({ action: 'submit_lead', ...session, ...values, consent: values.consent === 'on' });
      setLeadSent(true); setHandoff(result.handoff_status || handoff); setLeadOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to submit the enquiry.'); }
    finally { setBusy(false); }
  }

  function newConversation() {
    if (busy || uploadBusy || removingAttachment) return;
    if (session && !conversationEnded) request({ action: 'close', ...session }).catch(() => undefined);
    localStorage.removeItem(SESSION_KEY); setMessages([]); setPendingAttachment(null); setSession(null); setLeadSent(false); setHandoff('ai'); setRestoreFailed(false); setConversationEnded(false); setSendOutcomeUnknown(false); setPendingClientMessage(null); start();
  }

  return <main className="concierge-shell idheal-shell studio-shell">
    <PublicSiteNav />
    <h1 className="sr-only">OmniServe architectural visualization studio</h1>
    <section className="portal-grid" id="top" aria-label="OmniServe">
      <article className="portal-column portal-projects">
        <Link className="portal-heading" href="/projects"><span translate="no">OMN</span><small><i />Selected work</small></Link>
        <div className="portal-preview">
          <Link className="portal-image" href={`/projects/${PUBLIC_CASES[1].id}`}><Image alt={PUBLIC_CASES[1].alt_en} height={600} priority src={PUBLIC_CASES[1].image_url} unoptimized width={960} /></Link>
          <p>Architectural imagery shaped around design intent, material, light and human experience.</p>
          <Link className="portal-read" href="/projects">Explore projects +</Link>
        </div>
      </article>
      <article className="portal-column portal-team">
        <a className="portal-heading" href="#services"><span translate="no">IS</span><small><i />Services</small></a>
        <div className="portal-preview team-preview"><p>Still imagery, architectural animation and visual direction for architecture, development and design communication.</p><dl><div><dt>01</dt><dd>Still imagery</dd></div><div><dt>02</dt><dd>Animation &amp; walkthroughs</dd></div><div><dt>03</dt><dd>Visual direction</dd></div></dl><a className="portal-read" href="#services">View services +</a></div>
      </article>
      <article className="portal-column portal-visual">
        <a className="portal-heading" href="#references"><span translate="no">ER</span><small><i />Visual library</small></a>
        <div className="portal-preview"><a className="portal-image" href="#references"><Image alt="Warm hospitality lounge opening to a planted courtyard" height={1024} loading="eager" src="/generated/courtyard-lounge-interior.png" unoptimized width={1536} /></a><p>A long-form study of atmosphere, material, landscape, time of day and composition.</p><a className="portal-read" href="#references">Enter the visual library +</a></div>
      </article>
      <article className="portal-column portal-contact">
        <Link className="portal-heading" href="/team"><span translate="no">VE</span><small><i />Studio</small></Link>
        <div className="portal-preview ai-preview"><p>A focused team working across direction, 3D production, lighting and post-production.</p><ul><li>Project direction</li><li>3D &amp; environment</li><li>Post-production</li></ul><Link className="portal-read" href="/team">Inside the studio +</Link></div>
      </article>
      <nav className="portal-wordmark" aria-label="Main sections" translate="no">
        <Link href="/projects" aria-label="Selected work"><span>O</span><span>M</span><span>N</span></Link>
        <a href="#services" aria-label="Services"><span>I</span><span>S</span></a>
        <a href="#references" aria-label="Visual library"><span>E</span><span>R</span></a>
        <Link href="/team" aria-label="Studio"><span>V</span><span>E</span></Link>
      </nav>
    </section>
    <div className="portal-ticker" aria-hidden="true" translate="no"><div className="portal-ticker-track"><span>OMNISERVE · ARCHITECTURAL IMAGERY · ANIMATION · WALKTHROUGHS · VISUAL DIRECTION · </span><span>OMNISERVE · ARCHITECTURAL IMAGERY · ANIMATION · WALKTHROUGHS · VISUAL DIRECTION · </span></div></div>
    <section className="concierge-intro studio-intro" id="scope">
      <p>We make images that give unbuilt architecture a sense of place, light and life.</p>
      <div className="intro-details">
        <p>STILL IMAGERY · ARCHITECTURAL ANIMATION<br />WALKTHROUGHS · VISUAL DIRECTION · POST-PRODUCTION</p>
        <p>FROM EARLY DESIGN CONVERSATIONS<br />TO FINAL PRESENTATION IMAGERY</p>
      </div>
    </section>
    <section className="selected-work studio-work" id="work">
      <header><h2>{t.selected}</h2><p>{t.selectedIntro}</p></header>
      <div className="gallery-filters">{['All', ...new Set(PUBLIC_CASES.map((item) => item.building_type))].map((item) => <button className={galleryFilter === item ? 'active' : ''} key={item} onClick={() => setGalleryFilter(item)} type="button">{item}</button>)}</div>
      <div className="public-case-gallery">{galleryCases.map((item, index) => <article className={index === 0 ? 'featured' : ''} key={item.id}><Link className="case-link" href={`/projects/${item.id}`}><Image alt={conceptAlt(item.alt_en)} height={600} src={item.image_url} unoptimized width={960} /><div><small>{t.caseLabel}</small><h3>{item.title_en}</h3><p>{item.description_en}</p><span>{item.building_type} · {item.viewpoint} · {item.shot_scale} · {item.atmosphere.join(', ')}</span></div></Link></article>)}</div>
    </section>
    <section className="studio-services" id="services">
      <header><h2>What we make</h2><p>From one defining image to a complete campaign, every commission begins with architecture and ends with a coherent visual world.</p></header>
      <div className="studio-service-list">
        {SERVICES.map((service, index) => <details key={service.title} name="studio-services" open={index === 1}><summary><h3>{service.title}</h3><p>{service.summary}</p><span>{service.tags}</span><b aria-hidden="true">+</b></summary><div className="service-expansion"><p>{service.detail}</p><div><strong>Typical scope</strong><span>{service.includes}</span></div></div></details>)}
      </div>
    </section>
    <section className="studio-film" id="animation">
      <header><h2>Architectural<br />animation</h2><p>A walkthrough is designed as a spatial journey. Camera path, pace, atmosphere and edit are developed together so viewers understand how a place is approached, entered and inhabited.</p></header>
      <figure><Image alt="Architectural walkthrough frame entering a landscaped cultural pavilion" height={813} loading="lazy" src="/generated/cultural-pavilion-walkthrough.png" unoptimized width={1935} /><figcaption><span>Walkthrough study</span><span>Courtyard → threshold → atrium</span></figcaption></figure>
      <div className="film-sequence"><ol><li><time>00:00</time><strong>Establish the place</strong><span>Site, approach and first orientation.</span></li><li><time>00:06</time><strong>Cross the threshold</strong><span>Material, scale and movement become legible.</span></li><li><time>00:14</time><strong>Reveal the interior</strong><span>Program, people and daylight animate the space.</span></li><li><time>00:24</time><strong>Leave a final image</strong><span>The film resolves on one memorable spatial idea.</span></li></ol><div><p>Possible deliverables</p><p>Hero film · architectural walkthrough · fly-through · teaser · vertical and square edits · clean loops · selected still frames</p></div></div>
      <a className="film-cta" href="#concierge">Brief an architectural walkthrough +</a>
    </section>
    <section className="studio-statement">
      <p>Architecture is the subject. Atmosphere is how people remember it.</p>
      <Link href="/team">Meet the studio +</Link>
    </section>
    <section className="visual-references visual-library" aria-labelledby="visual-reference-title" id="references">
      <header><h2 id="visual-reference-title">Visual<br />Library</h2><p>Concept studies across architecture, interiors, landscape, light and atmosphere.</p></header>
      <div className="visual-library-grid">{VISUAL_LIBRARY.map((item, index) => <article className="visual-library-item" key={`${item.title}-${item.image}`}><Image alt={item.alt} decoding="async" height={1000} loading={index < 2 ? 'eager' : 'lazy'} sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw" src={item.image} unoptimized width={1600} /><div><strong>{item.title}</strong><span>{item.note}</span></div></article>)}</div>
    </section>
    <section className="concierge-services studio-enquiry" id="concierge">
      <header className="services-heading"><h2><span>Start a</span><span>Project</span></h2><p>Tell us what you are planning, ask a question, or request a follow-up from the project team.</p></header>
      <div className="concierge-stage">
        <aside className="concierge-index">
          <div className="index-rule"><span>PROJECT ENQUIRY</span><span>START A CONVERSATION</span></div>
          <Image alt="High aerial view of a coastal hospitality masterplan" height={1024} loading="lazy" src="/generated/coastal-hospitality-aerial.png" unoptimized width={1536} />
          <dl><div><dt>01</dt><dd>Tell us what you are planning</dd></div><div><dt>02</dt><dd>Share the images or film you need</dd></div><div><dt>03</dt><dd>Request a follow-up from our team</dd></div></dl>
        </aside>
        <div className="concierge-operating">
          <div className="conversation-surface"><div className="conversation-head"><div><strong>{t.chatTitle}</strong><span>{t.chatSubtitle}</span></div><div className="conversation-actions"><span className={`handoff-state ${handoff}`}>{conversationEnded || handoff === 'closed' ? 'Conversation ended' : handoff === 'human' ? 'Assigned to project team' : handoff === 'requested' ? 'Follow-up requested' : handoff === 'processing' ? 'Message being handled' : t.human}</span><button disabled={busy || !session || conversationEnded} onClick={retryRestore} type="button">{refreshing ? 'Refreshing…' : restoreFailed ? 'Retry restore' : t.refresh}</button></div></div>
          <div className="message-list" aria-live="polite" ref={messageListRef}>{messages.map((message) => <article className={`message ${message.sender}`} key={message.id}><span>{message.sender === 'assistant' ? 'Project assistant' : message.sender === 'human' ? 'Project team' : 'You'}</span><div className="message-content"><p>{message.content}</p>{message.attachments.map((attachment) => session && <ProtectedAttachment attachment={attachment} key={attachment.id} token={session.token} />)}{message.citations.length > 0 && <div className="public-citations">{message.citations.map((item) => <span key={item.document_id}>{item.title}</span>)}</div>}{message.sender !== 'customer' && message.mode === 'handoff' && <small className="message-boundary">Your enquiry has been passed to our team for follow-up.</small>}{message.sender === 'human' && message.mode === 'human' && <small className="message-boundary">Reply from the project team.</small>}{message.mode === 'refuse' && <small className="message-boundary refuse">The project team will review this question.</small>}{message.cases.length > 0 && <div className="chat-cases">{message.cases.map((item) => <article key={item.id}><Image alt={conceptAlt(item.alt || item.alt_en)} height={600} src={item.image_url} unoptimized width={960} /><div><strong>{item.title || item.title_en}</strong><span>{item.match_reason}</span><small>{t.caseLabel}</small></div></article>)}</div>}</div></article>)}{(busy || handoff === 'processing') && <div className="message assistant pending"><span>Project assistant</span><p>{handoff === 'processing' ? 'Your previous message is still being handled. Please wait for an update.' : refreshing ? 'Refreshing your conversation…' : t.loading}</p></div>}</div>
          <div className="prompt-row">{t.prompts.map((prompt) => <button disabled={busy || restoreFailed || conversationEnded || sendOutcomeUnknown || handoff === 'human' || handoff === 'processing'} key={prompt} onClick={() => setInput(prompt)} type="button">{prompt}</button>)}</div>{pendingAttachment && session && <div className="pending-attachment"><ProtectedAttachment attachment={pendingAttachment} token={session.token} /><span>{pendingAttachment.mime_type} · {(pendingAttachment.byte_size / 1024 / 1024).toFixed(1)} MB</span><button disabled={busy || uploadBusy || removingAttachment || sendOutcomeUnknown} onClick={removePendingAttachment} type="button">{removingAttachment ? 'Removing…' : 'Remove image'}</button></div>}<form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="customer-message">Project message</label><textarea disabled={!session || busy || restoreFailed || conversationEnded || handoff === 'processing' || sendOutcomeUnknown} id="customer-message" maxLength={3000} onChange={(event) => setInput(event.target.value)} placeholder={t.placeholder} rows={2} value={input} /><label className="image-upload-control"><span>{uploadBusy ? 'Uploading…' : pendingAttachment ? 'Remove current image first' : removingAttachment ? 'Removing image…' : 'Attach image'}</span><input accept="image/jpeg,image/png,image/webp" aria-label="Attach a JPEG, PNG or WebP project image" disabled={!session || busy || uploadBusy || removingAttachment || Boolean(pendingAttachment) || restoreFailed || conversationEnded || sendOutcomeUnknown} onChange={(event) => { uploadImage(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label><button disabled={(!input.trim() && !pendingAttachment) || !session || busy || uploadBusy || removingAttachment || restoreFailed || conversationEnded || handoff === 'processing'} type="submit">{t.send}</button></form><p className="message-guidance">Up to 3,000 characters · {Math.max(0, 3000 - input.length)} remaining</p>{error && <div className={`public-error${restoreFailed ? ' restore-error' : ''}`} role="alert"><span>{error}</span>{restoreFailed ? <><button disabled={busy} onClick={retryRestore} type="button">Retry restore</button><button disabled={busy || uploadBusy || removingAttachment} onClick={newConversation} type="button">New conversation</button></> : sendOutcomeUnknown ? <button disabled={busy} onClick={retryRestore} type="button">Refresh conversation</button> : conversationEnded ? <button disabled={busy || uploadBusy || removingAttachment} onClick={newConversation} type="button">New conversation</button> : <button onClick={() => setError('')} type="button">Close</button>}</div>}<p className="privacy-copy">{t.privacy}</p></div>
          <aside className="enquiry-context"><div className="brief-head"><div><span>Project team</span><strong>{leadSent ? t.sent : 'Request a follow-up'}</strong></div><b>{leadSent ? 'Sent' : 'Optional'}</b></div><p className="brief-empty">Share your contact details if you would like our team to follow up on this conversation.</p><div className="context-divider" />{leadSent ? <div className="lead-success"><strong>{t.sent}</strong><p>The project team has received your conversation and contact details. They will review your enquiry and follow up.</p></div> : <button aria-controls="project-follow-up-form" aria-expanded={leadOpen} className="lead-open-button" disabled={!session || restoreFailed || conversationEnded || busy} onClick={() => { if (!timeZoneChoice) setTimeZoneChoice(browserTimeZone()); setLeadOpen(true); }} type="button">{t.submit}</button>}{leadOpen && !leadSent && <form className="lead-form" id="project-follow-up-form" onSubmit={submitLead}><h2>{t.leadTitle}</h2><p>{t.leadIntro}</p><label>{t.name}<input disabled={conversationEnded || restoreFailed} name="name" required /></label><label>{t.organization}<input disabled={conversationEnded || restoreFailed} name="organization" /></label><label>{t.email}<input disabled={conversationEnded || restoreFailed} name="email" required type="email" /></label><div className="lead-form-split"><label>{t.country}<input disabled={conversationEnded || restoreFailed} name="country" required /></label><label>{t.timezone}<select disabled={conversationEnded || restoreFailed} name="timezone_choice" onChange={(event) => setTimeZoneChoice(event.target.value)} required value={timeZoneChoice}><option value="">Choose a time zone</option>{timeZoneChoice && !TIME_ZONE_GROUPS.some((group) => group.options.some((option) => option.value === timeZoneChoice)) && timeZoneChoice !== OTHER_TIME_ZONE && <option value={timeZoneChoice}>Browser setting — {timeZoneChoice}</option>}{TIME_ZONE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}<option value={OTHER_TIME_ZONE}>Other time zone</option></select></label></div>{timeZoneChoice === OTHER_TIME_ZONE && <label>{t.timezone}<input autoComplete="off" disabled={conversationEnded || restoreFailed} onChange={(event) => setOtherTimeZone(event.target.value)} placeholder="For example, Europe/Paris" value={otherTimeZone} /></label>}<p className="timezone-hint">Browser suggestions come from your settings, not precise location tracking. You can change the selection.</p><label className="consent-check"><input disabled={conversationEnded || restoreFailed} name="consent" required type="checkbox" /><span>{t.consent}</span></label><button disabled={busy || conversationEnded || restoreFailed} type="submit">{t.leadSend}</button></form>}<button className="restart-link" disabled={busy || uploadBusy || removingAttachment} onClick={newConversation} type="button">{t.restart}</button></aside>
        </div>
      </div>
    </section>
    <section className="public-boundaries" id="boundaries"><div><h2>{t.boundaries}</h2><p>{t.can}</p><p>{t.cannot}</p></div><aside><strong>{t.contact}</strong><p>{t.contactText}</p><a href="#concierge">{t.submit}</a></aside></section>
    <footer className="public-footer"><a className="public-brand" href="#top"><span aria-hidden="true">+</span><strong translate="no">OMNISERVE</strong></a><p>ARCHITECTURAL IMAGERY · ANIMATION · WALKTHROUGHS · VISUAL DIRECTION</p><a href="/privacy">DATA HANDLING</a></footer>
  </main>;
}
