import Link from 'next/link';
import PublicSiteNav from '../public-site-nav';

const roles = [
  ['Project direction', 'Keeps the architectural intent, visual priorities, review sequence and communication aligned from the first brief to final delivery.'],
  ['Art direction', 'Builds the image language through viewpoint, light, material, season, atmosphere and narrative.'],
  ['3D, environment & motion', 'Develops architecture, landscape, context, lighting and camera movement for still images, films and architectural walkthroughs.'],
  ['Post-production & delivery', 'Refines composition, colour, human presence and edit rhythm, then prepares a consistent set of still and motion deliverables.'],
] as const;

export default function TeamPage() {
  return <main className="editorial-page team-page">
    <PublicSiteNav section="studio" />
    <header className="editorial-masthead"><h1>Our studio</h1><p>Architectural designers, image makers and project directors working as one visual team.</p></header>
    <section className="team-intro"><p>Every image moves through direction, 3D production, lighting and finishing. The architecture stays at the centre while each discipline adds precision, atmosphere and life.</p></section>
    <section className="team-role-list">{roles.map(([title, description], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{description}</p></article>)}</section>
    <section className="team-availability"><h2>Work with us</h2><p>Exterior &amp; interior still imagery</p><p>Architectural animation &amp; walkthroughs</p><p>Visual direction · Post-production</p><p>Project communication · English</p><Link href="/#concierge">Start a project enquiry +</Link></section>
    <footer className="editorial-footer"><Link href="/projects">Browse projects +</Link><Link href="/">Return home +</Link></footer>
  </main>;
}
