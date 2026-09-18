import type { Quote } from '../types';

/**
 * The quote statuses a PORTAL CLIENT may see.
 *
 * This is not a display preference — it is half of a security rule. The
 * `quotes` read rule requires `resource.data.status` to be one of these for the
 * portal clause to hold, and Firestore evaluates a list rule against the QUERY
 * SHAPE, not against the documents it would return. So a portal query that does
 * not constrain `status` to exactly this set is denied OUTRIGHT — it does not
 * quietly return Drafts, it returns nothing at all.
 *
 * It lives in `lib/` rather than in one of the portal views because more than
 * one screen queries quotes (the Preventiva list and the dashboard counter). The
 * two used to keep their own copies, and importing one view from another would
 * also merge their lazy-loaded chunks.
 *
 * Drafts are excluded deliberately: a draft carries internal pricing that the
 * client has not been quoted yet.
 */
export const CLIENT_VISIBLE_QUOTE_STATUSES: Quote['status'][] = ['Sent', 'Accepted', 'Rejected'];
