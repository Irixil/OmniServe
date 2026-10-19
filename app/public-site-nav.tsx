'use client';

import Link from 'next/link';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';

const links = [
  ['Selected work', '/projects', 'blue'],
  ['Services', '/#services', 'terracotta'],
  ['Our studio', '/team', 'olive'],
  ['Start a project', '/#concierge', 'magenta'],
] as const;
const sectionLabels: Record<string, string> = { work: 'Selected work', project: 'Concept visualization', studio: 'Our studio' };

function HomeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 11 8-7 8 7v9H4z" /><path d="M9 20v-6h6v6" /></svg>;
}

export default function PublicSiteNav({ section }: { section?: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const background = [...document.querySelectorAll<HTMLElement>('main > :not(.site-toolbar)')];
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });
    menuRef.current?.querySelector<HTMLElement>('a')?.focus();

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      background.forEach((element) => {
        element.inert = false;
        element.removeAttribute('aria-hidden');
      });
      trigger?.focus();
    };
  }, [open]);

  function keepFocusInside(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a, button:not([disabled])')];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <header className="site-toolbar">
    <span aria-hidden="true" className="scroll-progress" />
    {section && <Link className="section-pill" href="/"><HomeIcon />{sectionLabels[section] || section}</Link>}
    <div className="site-tools">
      {!section && <Link className="top-start-project" href="/#concierge">Start a project</Link>}
      <Link aria-label="View our team" className="round-control" href="/team"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg></Link>
      <Link aria-label="Browse projects" className="round-control" href="/projects"><svg aria-hidden="true" viewBox="0 0 24 24"><rect height="7" rx="1" width="7" x="3" y="3" /><rect height="7" rx="1" width="7" x="14" y="3" /><rect height="7" rx="1" width="7" x="3" y="14" /><rect height="7" rx="1" width="7" x="14" y="14" /></svg></Link>
      <div className={`site-menu ${open ? 'is-open' : ''}`}>
        <button aria-expanded={open} aria-label={open ? 'Close site menu' : 'Open site menu'} className="round-control" onClick={() => setOpen((value) => !value)} ref={triggerRef} type="button"><svg className="menu-open-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg><svg className="menu-close-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m5 5 14 14M19 5 5 19" /></svg></button>
        {open && <nav aria-label="Site menu" onKeyDown={keepFocusInside} ref={menuRef}><Link className="home-link" href="/" onClick={() => setOpen(false)}><HomeIcon />Home</Link>{links.map(([label, href, tone]) => <Link href={href} key={href} onClick={() => setOpen(false)}><i className={tone} />{label}</Link>)}<div><Link href="/privacy" onClick={() => setOpen(false)}>Data handling</Link></div></nav>}
      </div>
    </div>
  </header>;
}
