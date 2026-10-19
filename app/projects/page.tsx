import Image from 'next/image';
import Link from 'next/link';
import { PUBLIC_CASES } from '../../lib/public-domain';
import PublicSiteNav from '../public-site-nav';

export default function ProjectsPage() {
  return <main className="editorial-page projects-page">
    <PublicSiteNav section="work" />
    <header className="editorial-masthead"><h1>Selected work</h1><p>Concept visualizations exploring building type, viewpoint, scale, material and atmosphere. Open a study to explore its visual direction.</p></header>
    <section className="project-index-grid">{PUBLIC_CASES.map((item, index) => <article className={`project-index-card card-${index + 1}`} key={item.id}><Link href={`/projects/${item.id}`}><div className="project-index-meta"><span>{String(index + 1).padStart(2, '0')}</span><span>{item.building_type}</span><small>Concept visualization</small></div><Image alt={`Concept visualization: ${item.alt_en.replace(/^Sample /, '')}`} height={600} priority={index < 2} src={item.image_url} unoptimized width={960} /><h2>{item.title_en}</h2><p>{item.description_en}</p><em>Explore study +</em></Link></article>)}</section>
    <footer className="editorial-footer"><Link href="/#concierge">Start a project enquiry +</Link><Link href="/team">Inside the studio +</Link></footer>
  </main>;
}
