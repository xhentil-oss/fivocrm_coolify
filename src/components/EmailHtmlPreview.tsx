import React from 'react';

/**
 * Renders email HTML for preview WITHOUT executing it.
 *
 * These previews used to be plain `dangerouslySetInnerHTML`, unlike the other eight
 * `dangerouslySetInnerHTML` sites in the app, which all sanitise first. That matters
 * because `emailTemplates` / `emailCampaigns` are writable by ANY business member
 * (`canCreateBusinessDoc()` in firestore.rules is just `isBusinessMember`): a Member
 * could store `<script>` in a template, and the Admin who opened it to look executed
 * it inside their own session, with their Firestore privileges.
 *
 * A sandboxed iframe is the right tool here rather than `sanitizeHtml()`: email HTML
 * legitimately needs `<style>`, table layout and inline attributes that the sanitiser
 * strips, so sanitising would show the admin a preview that does not match what the
 * recipient receives. `srcDoc` + a `sandbox` with NO `allow-scripts` and NO
 * `allow-same-origin` means scripts never run and the frame cannot reach our origin,
 * our cookies or our Firebase session — while the layout renders exactly as sent.
 */
export const EmailHtmlPreview: React.FC<{
  html: string;
  /** Tailwind height class for the frame (previews differ in size). */
  className?: string;
  title?: string;
}> = ({ html, className = 'h-48', title = 'Pamja paraprake e email-it' }) => (
  <iframe
    title={title}
    // No allow-scripts, no allow-same-origin — both are required for this to be a
    // boundary rather than decoration. Do not add either one.
    sandbox=""
    srcDoc={html}
    referrerPolicy="no-referrer"
    className={`w-full rounded-md border border-border bg-white ${className}`}
  />
);

export default EmailHtmlPreview;
