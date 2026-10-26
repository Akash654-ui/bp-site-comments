=== Site Comments by BornPixel ===
Contributors: bornpixel
Tags: feedback, review, comments, client, annotation
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 1.1.0
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

= 1.1.0 =
* Interface moved into a Shadow DOM so it works with any theme.
* High-contrast hover frame, pins and launcher that stay visible on any background.
* Redesigned Comment mode toolbar.

= 1.0.0 =
* First release.
