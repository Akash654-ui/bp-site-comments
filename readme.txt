=== Site Comments by BornPixel ===
Contributors: bornpixel
Tags: feedback, review, comments, client, annotation
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 1.4.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Leave feedback on any text, image or section of a live site. Comments are pinned to the spot, with replies and resolve.

== Description ==

Turn on Comment mode, click any heading, paragraph, image, button or section of the live site, and type. The comment is pinned to that exact spot so everyone knows what it refers to. Reply, resolve and track everything from the page or from Site Comments in the dashboard.

* Comment on anything: hover outlines and labels the element; press Up to select the surrounding box.
* Numbered pins with threaded replies, resolve and reopen.
* A list of every comment on the current page, split into Open and Resolved.
* A dashboard list of every comment across the site, with an open-count badge.
* Logged-in users only. Visitors load nothing.
* Works with any theme: the interface runs in its own Shadow DOM and stays readable on any background.
* Links and buttons don't fire while commenting.

== Installation ==

1. Upload the plugin zip in Plugins > Add New > Upload Plugin, or copy the bp-site-comments folder into wp-content/plugins.
2. Activate it.
3. Open any page while logged in and click Comment at the bottom left, or press C.

== Frequently Asked Questions ==

= Who can comment? =

Any logged-in user. Editors and administrators can also resolve and delete other people's comments. Both are adjustable with the bp_sc_capability and bp_sc_manage_capability filters.

= Can visitors see comments? =

No. Nothing is loaded for logged-out visitors.

= What happens to comments if I delete the plugin? =

They are removed. Add define( 'BP_SC_KEEP_DATA', true ); to wp-config.php to keep them.

== Changelog ==

= 1.4.1 =
* Every message you wrote has its own Edit and Delete for 15 minutes: your comment and each of your replies (deleting asks once more to be sure). The old Delete button for the whole thread is gone.
* Web addresses and email addresses in comments and replies are clickable and open in a new tab (site and dashboard).
* A stray click on the page or another pin no longer throws away a comment you are typing.
* Comments and replies stop at 5,000 characters while typing, the same limit the server keeps.
* Site managers can delete individual replies, including ones saved before this version (also from the dashboard).

= 1.4.0 =
* Links stay usable in Comment mode: Ctrl + click (Cmd + click on Mac) or middle-click opens a link, and the comment box of a link has an "Open link" button (works on phones too).
* Authors can edit or delete their own comment for 15 minutes after posting; a note shows the time left. After that only site managers can delete it, and nobody can change its text. The server enforces this too. Change the window with the bp_sc_edit_window filter.

= 1.3.3 =
* iPhone and iPad: tapping text, headings or boxes in Comment mode now opens the comment box (Safari sends no click for those taps).
* Pins no longer float over the page when their element is scrolled out of view inside a scrolling list, carousel or ticker.
* Pins behind the Comment toolbar or the comment list stay hidden until scrolled into the clear, so every visible pin can be clicked.
* Pages stay smooth when a commented element has been removed from the page.

= 1.3.2 =
* An empty Trash (for example after deleting its last comments) now returns to the dashboard with a message, instead of showing an empty WordPress list.
* The Trash screen no longer shows the old All, Open and Resolved links.

= 1.3.1 =
* Dashboard: a Select all checkbox above the list (and Ctrl+A) selects every comment in the current view for bulk Resolve, Reopen or Trash.

= 1.3.0 =
* New Site Comments dashboard in wp-admin, replacing the plain post list:
  * Three panes: views and pages (with counts and a progress ring), the comment list, and the selected conversation.
  * Each comment shows who left it, the page, what it is on and its replies; click it to read and reply.
  * Resolve and Trash on every row, bulk select, and Undo for every change.
  * Keyboard: Up/Down or J/K to move, Enter to open, E to resolve, R to reply, X to select, / to search, Esc to close.
  * Search, person and sort filters, kept in the address bar.
  * Illustrated empty states: getting started, pick a comment, all caught up, page done, no matches.
  * Works on phones and tablets.
* "Review the site" and "Open page" open the site with Comment mode already on.
* FAQ questions are labelled "Question"; avatars show initials when there is no profile photo.

= 1.2.0 =
* Fix: on phones and tablets the page could not be scrolled, and tapping did not open a comment box, while Comment mode was on.
* Fix: text that looked like HTML (for example "change <h2> to <h3>") was removed from comments. Comments are now kept exactly as typed.
* Fix: pins drifted away from animated or moving content. They now follow their element.
* Fix: Bulk edit in the dashboard could turn comments into drafts and hide them.
* New: edit your own comments.
* New: "Bigger area" and "Smaller area" buttons in the comment box, for touch screens without arrow keys.
* New comments from other people appear when you start commenting, open the list or come back to the tab.
* The comment box no longer covers the admin bar, and the toolbar moves aside when the list is open.
* Clearer messages when your login session has expired.
* The View on page link no longer leaves ?bp-comment in the address bar.
* "Show resolved" label, hover label clear of pins, no meaningless "Published" filter.
* Avatar fallback works on sites with a strict Content Security Policy.

= 1.1.3 =
* The comment list and long threads now scroll with the mouse wheel on sites that use smooth scrolling (Lenis, MouseWheel Smooth Scroll).

= 1.1.2 =
* Comment mode no longer switches itself back on after a page reload. It starts off on every page and turns on only when clicked.

= 1.1.1 =
* Fix: Delete Permanently and Restore in Site Comments > Trash opened the page instead of acting.
* Trash rows now show WordPress's Restore and Delete Permanently links.
* Fix: a restored comment came back as a draft and no longer showed on the page.

= 1.1.0 =
* Interface moved into a Shadow DOM so it works with any theme.
* High-contrast hover frame, pins and launcher that stay visible on any background.
* Redesigned Comment mode toolbar.

= 1.0.0 =
* First release.
