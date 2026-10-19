import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PUBLIC_CASES } from '../../../lib/public-domain';
import PublicSiteNav from '../../public-site-nav';

export function generateStaticParams() {
  return PUBLIC_CASES.map(({ id }) => ({ id }));
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = PUBLIC_CASES.find((item) => item.id === id);
  if (!project) notFound();
  const index = PUBLIC_CASES.indexOf(project);
  const previous = PUBLIC_CASES[(index - 1 + PUBLIC_CASES.length) % PUBLIC_CASES.length];
  const next = PUBLIC_CASES[(index + 1) % PUBLIC_CASES.length];
  return <main className="editorial-page project-detail-page">
    <PublicSiteNav section="project" />
    <header className="project-detail-head"><div><small>Concept visualization</small><h1>{project.title_en}</h1></div><dl><div><dt>Building type</dt><dd>{project.building_type}</dd></div><div><dt>Viewpoint</dt><dd>{project.viewpoint}</dd></div><div><dt>Shot scale</dt><dd>{project.shot_scale}</dd></div><div><dt>Atmosphere</dt><dd>{project.atmosphere.join(', ')}</dd></div></dl></header>
    <Image className="project-detail-image" alt={`Concept visualization: ${project.alt_en.replace(/^Sample /, '')}`} height={900} priority src={project.image_url} unoptimized width={1440} />
    <section className="project-detail-copy"><p>{project.description_en}</p><p>This visual study explores a direction across composition, light, material and atmosphere. It can inform a coordinated still-image set, arrival sequence or architectural walkthrough once the route and production scope are reviewed.</p><Link href="/#concierge">Discuss a project in this direction +</Link></section>
    <section className="project-detail-scope"><h2>Possible visual scope</h2><dl><div><dt>Still imagery</dt><dd>Exterior, interior, landscape and detail views developed as one image set.</dd></div><div><dt>Animation</dt><dd>Storyboard, animatic and camera-led walkthrough from approach to interior experience.</dd></div><div><dt>Direction</dt><dd>Viewpoint, season, light, material response, people and narrative aligned before production.</dd></div><div><dt>Delivery</dt><dd>Presentation masters, web and campaign formats, motion edits and selected film stills.</dd></div></dl></section>
    <nav className="project-detail-nav"><Link href={`/projects/${previous.id}`}>← {previous.title_en}</Link><Link href="/projects">All work</Link><Link href={`/projects/${next.id}`}>{next.title_en} →</Link></nav>
  </main>;
}
