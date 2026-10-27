# Site Comments by BornPixel

Leave feedback directly on a live WordPress site. Turn on **Comment mode**, click any heading, paragraph, image, button or section, and type. The comment is pinned to that spot so everyone sees exactly what it refers to, and the team can reply, resolve and track it.

Built for client reviews: no screenshots, no "the third paragraph under the second image" emails.

## Features

- **Comment on anything.** Hover outlines the element under the pointer and labels it (Heading, Image, Paragraph, Button, Section…). Press <kbd>↑</kbd> to select the surrounding box or section, <kbd>↓</kbd> to go back.
- **Pinned threads.** Each comment becomes a numbered pin on the element. Open it to reply, resolve, reopen or delete.
- **Page list.** *All comments* shows every comment on the current page, split into Open and Resolved; click one to jump to it.
- **Dashboard.** *Site Comments* in wp-admin is a three-pane review screen: views and pages on the left (with counts and progress), the comment list in the middle, and the selected conversation on the right. Resolve, reply and trash with a click or the keyboard (↑/↓, Enter, E, R, X, /), bulk actions, Undo, search and filters. *Review the site* opens the site with Comment mode on.
- **Private.** Only logged-in users can see or use it. Visitors load nothing: no script, no styles, no requests.
- **Works with any theme.** The interface runs inside its own Shadow DOM, so theme CSS cannot restyle or hide it and none of its styles leak into the site. Colours are built to stay readable on any background (light, dark, brand red or photos).
- **Safe clicks.** While Comment mode is on, links and buttons don't fire, so nobody navigates away by accident.
- **Keyboard friendly.** <kbd>C</kbd> toggles Comment mode, <kbd>Enter</kbd> comments on the outlined element, <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> posts, <kbd>Esc</kbd> closes.

## Requirements

- WordPress 6.5 or later
- PHP 8.0 or later
- The WordPress REST API enabled (it is by default)

## Installation

1. Download **`bp-site-comments.zip`** from the [latest release](../../releases/latest).
2. In WordPress go to **Plugins › Add New › Upload Plugin**, choose the zip and click **Install Now**.
3. Click **Activate**.

> Use the release zip rather than GitHub's green *Code › Download ZIP* button. That archive unpacks into a folder named `bp-site-comments-main`, which works but would not update cleanly.

## Usage

1. Log in and open any page of the site.
2. Click **Comment** at the bottom left (or **Comment mode** in the admin bar, or press <kbd>C</kbd>).
3. Click the thing you want to comment on, type, and press **Post**.
4. Click **Done** (or press <kbd>Esc</kbd>) to browse normally again.

## Permissions

| Who | Can |
| --- | --- |
| Any logged-in user | Comment, reply, resolve or delete their own comments |
| Editors and administrators (`edit_others_posts`) | Also resolve, reopen and delete anyone's comments, and see the dashboard list |

Change these with filters, for example in a small mu-plugin or your theme's `functions.php`:

```php
// Only people who can edit posts may comment.
add_filter( 'bp_sc_capability', fn() => 'edit_posts' );

// Only administrators may resolve or delete other people's comments.
add_filter( 'bp_sc_manage_capability', fn() => 'manage_options' );
```

## Developer hooks

| Hook | Type | When |
| --- | --- | --- |
| `bp_sc_capability` | filter | Capability needed to comment (default `read`) |
| `bp_sc_manage_capability` | filter | Capability needed to manage others' comments (default `edit_others_posts`) |
| `bp_sc_comment_added` | action | After a comment is created; receives the comment ID |
| `bp_sc_reply_added` | action | After a reply is added; receives the comment ID |

For example, to email the site admin about new comments:

```php
add_action( 'bp_sc_comment_added', function ( $id ) {
	$url = add_query_arg( 'bp-comment', $id, get_post_meta( $id, '_bp_sc_page_url', true ) );
	wp_mail( get_option( 'admin_email' ), 'New site comment', get_post_field( 'post_content', $id ) . "\n\n" . $url );
} );
```

## REST API

All routes need a logged-in user and the `wp_rest` nonce.

| Method | Route | Does |
| --- | --- | --- |
| `GET` | `/wp-json/bp-site-comments/v1/comments?url=…` | Comments for a page |
| `POST` | `/wp-json/bp-site-comments/v1/comments` | New comment (`text`, `url`, `selector`, `snippet`, `tag`, `title`) |
| `PATCH` | `/wp-json/bp-site-comments/v1/comments/{id}` | Edit `text` (author) or set `status` to `open` / `resolved` |
| `DELETE` | `/wp-json/bp-site-comments/v1/comments/{id}` | Move a comment to the trash |
| `POST` | `/wp-json/bp-site-comments/v1/comments/{id}/replies` | Add a reply (`text`) |

## Data

Each comment is a private post of type `bp_site_comment`, with its replies stored in post meta. Deleting a comment from the page moves it to *Site Comments › Trash*, where it can be restored.

Deleting the plugin from **Plugins** removes all stored comments. To keep them, add this to `wp-config.php` before deleting:

```php
define( 'BP_SC_KEEP_DATA', true );
```

## FAQ

**Can visitors see the comments?** No. Nothing is loaded for logged-out visitors.

**Do comments survive content changes?** Each comment remembers the element's position on the page and its text. If the layout changes, it finds the same text elsewhere on the page. If that is gone too, the comment is still listed, marked *element changed*.

**Does it work with page builders (Elementor, Divi, Gutenberg)?** Yes. It works on the rendered page, whatever built it.

**Does it work with caching plugins?** Yes. Caching plugins don't serve cached pages to logged-in users by default, and the plugin only runs for logged-in users.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

Made by [BornPixel](https://bornpixel.com/).
