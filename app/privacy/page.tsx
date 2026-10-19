import Link from 'next/link';

export default function PrivacyPage() {
  return <main className="privacy-page"><header><Link href="/">Back to <span translate="no">OmniServe</span></Link><span>Data handling</span></header><article>
    <h1>How we handle your information</h1>
    <p>This notice explains how information is handled when you contact the project team through this website.</p>
    <section><h2>Information we collect</h2><p>We store the messages and images you send, project details discussed in the conversation, and the conversation’s status. When you start a conversation, we receive the time zone suggested by your browser settings; it is not precise location data. You can change it before requesting follow-up. If you request a follow-up, we collect the contact details you provide after you agree to be contacted.</p></section>
    <section><h2>How we use it</h2><p>We use your conversation to answer your enquiry and help the project team review or continue it. Automated assistance may process messages and images to help prepare a response. Contact details are used only to follow up on your request.</p></section>
    <section><h2>Images</h2><p>You may attach JPEG, PNG or WebP images up to 10 MB each. Please upload only material you are authorized to share. For privacy, save a copy without embedded camera or location details before uploading. When image analysis is available, it may help us respond to your enquiry. If it is unavailable, the image remains with the enquiry for a team member to review.</p></section>
    <section><h2>Access</h2><p>We use published information and images approved for public display to respond to enquiries. Authorized team members can review the conversation, any submitted contact details, and attached images. Customer conversations and leads are not available to other customers.</p></section>
    <section><h2>Retention</h2><p>Contact details you submit for a follow-up are stored with that conversation. Access to the conversation, attached images and contact details expires after seven days. Expired records are removed later through routine cleanup.</p></section>
    <section><h2>Contact</h2><p>The website contact identity is iRIXI. For privacy or information questions, use the <Link href="/#concierge">project enquiry form</Link>.</p></section>
    <section><h2>Your choices</h2><p>You can ask questions without submitting contact details. If you request a follow-up, the form explains how your details will be used and asks for your consent. Please share only information relevant to your enquiry.</p></section>
  </article></main>;
}
