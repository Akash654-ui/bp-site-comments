<?php
/**
 * Plugin Name:       Site Comments by BornPixel
 * Plugin URI:        https://github.com/Akash654-ui/bp-site-comments
 * Description:       Review the live site and leave comments on any text, image, box or section. Logged-in users turn on Comment mode from the round button or the admin bar, click anything on the page and type. Comments are pinned to that spot, can be replied to and resolved, and are listed under Site Comments in the dashboard. Visitors never see any of it.
 * Version:           1.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            BornPixel
 * Author URI:        https://bornpixel.com/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       bp-site-comments
 * Domain Path:       /languages
 * Update URI:        https://github.com/Akash654-ui/bp-site-comments
 *
 * @package BP_Site_Comments
 */

defined( 'ABSPATH' ) || exit;

define( 'BP_SC_VERSION', '1.1.0' );
define( 'BP_SC_URL', plugin_dir_url( __FILE__ ) );
define( 'BP_SC_TYPE', 'bp_site_comment' );

add_action( 'init', fn() => load_plugin_textdomain( 'bp-site-comments', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' ) );

/** Cut text to a length, without relying on the mbstring extension (not every host has it). */
function bp_sc_cut( string $text, int $length ): string {
	return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $length ) : wp_html_excerpt( $text, $length );
}

/**
 * Who can comment. Any logged-in user by default (client, editor, admin...).
 * Change with: add_filter( 'bp_sc_capability', fn() => 'edit_posts' );
 */
function bp_sc_can_comment(): bool {
	return is_user_logged_in() && current_user_can( apply_filters( 'bp_sc_capability', 'read' ) );
}

/** Who can resolve, reopen or delete other people's comments. */
function bp_sc_can_manage(): bool {
	return current_user_can( apply_filters( 'bp_sc_manage_capability', 'edit_others_posts' ) );
}

/** A page's key: its path and query without tracking or comment params, so /menu/ and /menu/?utm=x match. */
function bp_sc_page_key( string $url ): string {
	$parts = wp_parse_url( $url );
	$path  = '/' . ltrim( $parts['path'] ?? '/', '/' );
	$path  = trailingslashit( $path );
	$query = array();
	if ( ! empty( $parts['query'] ) ) {
		wp_parse_str( $parts['query'], $query );
		$query = array_filter(
			$query,
			fn( $k ) => ! preg_match( '/^(utm_|fbclid|gclid|v$|ver$|bp-comment|bp-comments)/', (string) $k ),
			ARRAY_FILTER_USE_KEY
		);
		ksort( $query );
	}
	return $query ? $path . '?' . http_build_query( $query ) : $path;
}

/* -------------------------------------------------------------------------
 * Storage: one private post per comment; replies live in post meta.
 * ---------------------------------------------------------------------- */
add_action(
	'init',
	function () {
		register_post_type(
			BP_SC_TYPE,
			array(
				'labels'          => array(
					'name'          => __( 'Site Comments', 'bp-site-comments' ),
					'singular_name' => __( 'Site Comment', 'bp-site-comments' ),
					'all_items'     => __( 'All comments', 'bp-site-comments' ),
					'edit_item'     => __( 'Comment', 'bp-site-comments' ),
					'search_items'  => __( 'Search comments', 'bp-site-comments' ),
					'not_found'     => __( 'No comments yet. Open any page and turn on Comment mode.', 'bp-site-comments' ),
				),
				'public'          => false,
				'show_ui'         => true,
				'show_in_menu'    => true,
				'menu_icon'       => 'dashicons-format-chat',
				'menu_position'   => 26,
				'supports'        => array( 'author' ),
				'capability_type' => 'post',
				'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
				'map_meta_cap'    => true,
				'rewrite'         => false,
				'query_var'       => false,
			)
		);
		foreach ( array( 'page_key', 'page_url', 'page_title', 'selector', 'snippet', 'tag', 'status' ) as $key ) {
			register_post_meta( BP_SC_TYPE, "_bp_sc_{$key}", array( 'type' => 'string', 'single' => true ) );
		}
	}
);

/** One comment as the front end sees it. */
function bp_sc_format( WP_Post $post ): array {
	$meta    = fn( $k ) => (string) get_post_meta( $post->ID, "_bp_sc_{$k}", true );
	$author  = get_userdata( (int) $post->post_author );
	$replies = json_decode( $meta( 'replies' ) ?: '[]', true );
	return array(
		'id'        => $post->ID,
		'text'      => $post->post_content,
		'author'    => $author ? $author->display_name : __( 'Someone', 'bp-site-comments' ),
		'avatar'    => get_avatar_url( (int) $post->post_author, array( 'size' => 64 ) ),
		'mine'      => (int) $post->post_author === get_current_user_id(),
		'date'      => get_post_time( 'c', true, $post ),
		'selector'  => $meta( 'selector' ),
		'snippet'   => $meta( 'snippet' ),
		'tag'       => $meta( 'tag' ),
		'status'    => $meta( 'status' ) ?: 'open',
		'page_url'  => $meta( 'page_url' ),
		'page_title' => $meta( 'page_title' ),
		'replies'   => is_array( $replies ) ? $replies : array(),
	);
}

/* -------------------------------------------------------------------------
 * REST API: /wp-json/bp-site-comments/v1/comments
 * ---------------------------------------------------------------------- */
add_action(
	'rest_api_init',
	function () {
		$ns   = 'bp-site-comments/v1';
		$auth = fn() => bp_sc_can_comment();

		register_rest_route(
			$ns,
			'/comments',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => $auth,
					'args'                => array( 'url' => array( 'type' => 'string', 'required' => true ) ),
					'callback'            => function ( WP_REST_Request $r ) {
						$posts = get_posts(
							array(
								'post_type'      => BP_SC_TYPE,
								'post_status'    => 'publish',
								'posts_per_page' => 500,
								'orderby'        => 'date',
								'order'          => 'ASC',
								'meta_key'       => '_bp_sc_page_key', // phpcs:ignore WordPress.DB.SlowDBQuery
								'meta_value'     => bp_sc_page_key( (string) $r['url'] ), // phpcs:ignore WordPress.DB.SlowDBQuery
							)
						);
						return array_map( 'bp_sc_format', $posts );
					},
				),
				array(
					'methods'             => 'POST',
					'permission_callback' => $auth,
					'args'                => array(
						'text'     => array( 'type' => 'string', 'required' => true ),
						'url'      => array( 'type' => 'string', 'required' => true ),
						'selector' => array( 'type' => 'string', 'required' => true ),
						'snippet'  => array( 'type' => 'string', 'default' => '' ),
						'tag'      => array( 'type' => 'string', 'default' => '' ),
						'title'    => array( 'type' => 'string', 'default' => '' ),
					),
					'callback'            => function ( WP_REST_Request $r ) {
						$text = trim( sanitize_textarea_field( (string) $r['text'] ) );
						if ( '' === $text ) {
							return new WP_Error( 'bp_sc_empty', __( 'Write a comment first.', 'bp-site-comments' ), array( 'status' => 400 ) );
						}
						$url = esc_url_raw( (string) $r['url'] );
						$id  = wp_insert_post(
							array(
								'post_type'    => BP_SC_TYPE,
								'post_status'  => 'publish',
								'post_author'  => get_current_user_id(),
								'post_title'   => wp_trim_words( $text, 10, '…' ),
								'post_content' => $text,
								'meta_input'   => array(
									'_bp_sc_page_key'   => bp_sc_page_key( $url ),
									'_bp_sc_page_url'   => $url,
									'_bp_sc_page_title' => sanitize_text_field( (string) $r['title'] ),
									'_bp_sc_selector'   => sanitize_text_field( (string) $r['selector'] ),
									'_bp_sc_snippet'    => bp_sc_cut( sanitize_text_field( (string) $r['snippet'] ), 160 ),
									'_bp_sc_tag'        => sanitize_key( (string) $r['tag'] ),
									'_bp_sc_status'     => 'open',
									'_bp_sc_replies'    => '[]',
								),
							),
							true
						);
						if ( is_wp_error( $id ) ) {
							return $id;
						}
						do_action( 'bp_sc_comment_added', $id );
						return bp_sc_format( get_post( $id ) );
					},
				),
			)
		);

		$get_comment = function ( WP_REST_Request $r ) {
			$post = get_post( (int) $r['id'] );
			return ( $post && BP_SC_TYPE === $post->post_type ) ? $post : null;
		};

		register_rest_route(
			$ns,
			'/comments/(?P<id>\d+)',
			array(
				array(
					// Edit text (author only), resolve / reopen (author or manager).
					'methods'             => 'PATCH',
					'permission_callback' => $auth,
					'callback'            => function ( WP_REST_Request $r ) use ( $get_comment ) {
						$post = $get_comment( $r );
						if ( ! $post ) {
							return new WP_Error( 'bp_sc_missing', __( 'Comment not found.', 'bp-site-comments' ), array( 'status' => 404 ) );
						}
						$mine = (int) $post->post_author === get_current_user_id();
						if ( ! $mine && ! bp_sc_can_manage() ) {
							return new WP_Error( 'bp_sc_forbidden', __( 'Only the author or a site manager can change this comment.', 'bp-site-comments' ), array( 'status' => 403 ) );
						}
						if ( null !== $r['status'] ) {
							update_post_meta( $post->ID, '_bp_sc_status', 'resolved' === $r['status'] ? 'resolved' : 'open' );
						}
						if ( null !== $r['text'] && $mine ) {
							$text = trim( sanitize_textarea_field( (string) $r['text'] ) );
							if ( '' !== $text ) {
								wp_update_post( array( 'ID' => $post->ID, 'post_content' => $text, 'post_title' => wp_trim_words( $text, 10, '…' ) ) );
							}
						}
						return bp_sc_format( get_post( $post->ID ) );
					},
				),
				array(
					'methods'             => 'DELETE',
					'permission_callback' => $auth,
					'callback'            => function ( WP_REST_Request $r ) use ( $get_comment ) {
						$post = $get_comment( $r );
						if ( ! $post ) {
							return new WP_Error( 'bp_sc_missing', __( 'Comment not found.', 'bp-site-comments' ), array( 'status' => 404 ) );
						}
						if ( (int) $post->post_author !== get_current_user_id() && ! bp_sc_can_manage() ) {
							return new WP_Error( 'bp_sc_forbidden', __( 'Only the author or a site manager can delete this comment.', 'bp-site-comments' ), array( 'status' => 403 ) );
						}
						wp_trash_post( $post->ID ); // Recoverable from Site Comments › Trash.
						return array( 'deleted' => true );
					},
				),
			)
		);

		register_rest_route(
			$ns,
			'/comments/(?P<id>\d+)/replies',
			array(
				'methods'             => 'POST',
				'permission_callback' => $auth,
				'args'                => array( 'text' => array( 'type' => 'string', 'required' => true ) ),
				'callback'            => function ( WP_REST_Request $r ) use ( $get_comment ) {
					$post = $get_comment( $r );
					$text = trim( sanitize_textarea_field( (string) $r['text'] ) );
					if ( ! $post || '' === $text ) {
						return new WP_Error( 'bp_sc_bad', __( 'Write a reply first.', 'bp-site-comments' ), array( 'status' => 400 ) );
					}
					$user      = wp_get_current_user();
					$replies   = json_decode( (string) get_post_meta( $post->ID, '_bp_sc_replies', true ) ?: '[]', true ) ?: array();
					$replies[] = array(
						'author' => $user->display_name,
						'avatar' => get_avatar_url( $user->ID, array( 'size' => 64 ) ),
						'text'   => $text,
						'date'   => gmdate( 'c' ),
					);
					update_post_meta( $post->ID, '_bp_sc_replies', wp_slash( wp_json_encode( $replies ) ) );
					do_action( 'bp_sc_reply_added', $post->ID );
					return bp_sc_format( get_post( $post->ID ) );
				},
			)
		);
	}
);

/* -------------------------------------------------------------------------
 * Front end: only for people who can comment, never for visitors.
 * ---------------------------------------------------------------------- */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! bp_sc_can_comment() || is_customize_preview() ) {
			return;
		}
		// The stylesheet is loaded inside the plugin's shadow root (see site-comments.js), not on the page.
		wp_enqueue_script( 'bp-site-comments', BP_SC_URL . 'assets/site-comments.js', array(), BP_SC_VERSION, array( 'strategy' => 'defer', 'in_footer' => true ) );
		wp_localize_script(
			'bp-site-comments',
			'bpSiteComments',
			array(
				'api'    => esc_url_raw( rest_url( 'bp-site-comments/v1/comments' ) ),
				'css'    => esc_url_raw( add_query_arg( 'ver', BP_SC_VERSION, BP_SC_URL . 'assets/site-comments.css' ) ),
				'nonce'  => wp_create_nonce( 'wp_rest' ),
				'manage' => bp_sc_can_manage(),
				'user'   => wp_get_current_user()->display_name,
				'admin'  => admin_url( 'edit.php?post_type=' . BP_SC_TYPE ),
			)
		);
	}
);

// Admin bar: "Comment mode" toggle with the open count for this page (filled in by the script).
add_action(
	'admin_bar_menu',
	function ( WP_Admin_Bar $bar ) {
		if ( is_admin() || ! bp_sc_can_comment() ) {
			return;
		}
		$bar->add_node(
			array(
				'id'    => 'bp-site-comments',
				'title' => '<span class="ab-icon dashicons dashicons-format-chat" aria-hidden="true"></span><span class="ab-label">' . esc_html__( 'Comment mode', 'bp-site-comments' ) . '</span>',
				'href'  => '#bp-comments',
				'meta'  => array( 'class' => 'bp-sc-adminbar' ),
			)
		);
	},
	90
);

/* -------------------------------------------------------------------------
 * Dashboard list: Site Comments.
 * ---------------------------------------------------------------------- */
add_filter(
	'manage_' . BP_SC_TYPE . '_posts_columns',
	fn() => array(
		'cb'         => '<input type="checkbox" />',
		'bp_comment' => __( 'Comment', 'bp-site-comments' ),
		'bp_page'    => __( 'Page', 'bp-site-comments' ),
		'bp_status'  => __( 'Status', 'bp-site-comments' ),
		'author'     => __( 'By', 'bp-site-comments' ),
		'date'       => __( 'Date', 'bp-site-comments' ),
	)
);

add_action(
	'manage_' . BP_SC_TYPE . '_posts_custom_column',
	function ( $col, $id ) {
		$c = bp_sc_format( get_post( $id ) );
		if ( 'bp_comment' === $col ) {
			$link = add_query_arg( 'bp-comment', $id, $c['page_url'] );
			echo '<strong><a href="' . esc_url( $link ) . '" target="_blank" rel="noopener">' . esc_html( wp_trim_words( $c['text'], 30, '…' ) ) . '</a></strong>';
			if ( $c['snippet'] ) {
				echo '<br><span style="color:#646970">' . esc_html__( 'On:', 'bp-site-comments' ) . ' “' . esc_html( wp_trim_words( $c['snippet'], 14, '…' ) ) . '”</span>';
			}
			if ( $c['replies'] ) {
				/* translators: %d: number of replies. */
				echo '<br><span style="color:#646970">' . esc_html( sprintf( _n( '%d reply', '%d replies', count( $c['replies'] ), 'bp-site-comments' ), count( $c['replies'] ) ) ) . '</span>';
			}
			echo '<div class="row-actions"><a href="' . esc_url( $link ) . '" target="_blank" rel="noopener">' . esc_html__( 'View on page', 'bp-site-comments' ) . '</a> | <a href="' . esc_url( get_delete_post_link( $id ) ) . '">' . esc_html__( 'Trash', 'bp-site-comments' ) . '</a></div>';
		} elseif ( 'bp_page' === $col ) {
			echo esc_html( $c['page_title'] ?: bp_sc_page_key( $c['page_url'] ) ) . '<br><code>' . esc_html( bp_sc_page_key( $c['page_url'] ) ) . '</code>';
		} elseif ( 'bp_status' === $col ) {
			echo 'resolved' === $c['status']
				? '<span style="color:#00a32a;font-weight:600">' . esc_html__( 'Resolved', 'bp-site-comments' ) . '</span>'
				: '<span style="color:#c8202b;font-weight:600">' . esc_html__( 'Open', 'bp-site-comments' ) . '</span>';
		}
	},
	10,
	2
);

// Filter the list by status: Open / Resolved views.
add_filter(
	'views_edit-' . BP_SC_TYPE,
	function ( $views ) {
		$base = admin_url( 'edit.php?post_type=' . BP_SC_TYPE );
		$cur  = sanitize_key( $_GET['bp_status'] ?? '' ); // phpcs:ignore WordPress.Security.NonceVerification
		foreach ( array( 'open' => __( 'Open', 'bp-site-comments' ), 'resolved' => __( 'Resolved', 'bp-site-comments' ) ) as $k => $label ) {
			$n           = count( get_posts( array( 'post_type' => BP_SC_TYPE, 'fields' => 'ids', 'posts_per_page' => -1, 'meta_key' => '_bp_sc_status', 'meta_value' => $k ) ) ); // phpcs:ignore WordPress.DB.SlowDBQuery
			$views[ $k ] = sprintf( '<a href="%s"%s>%s <span class="count">(%d)</span></a>', esc_url( add_query_arg( 'bp_status', $k, $base ) ), $cur === $k ? ' class="current"' : '', esc_html( $label ), $n );
		}
		return $views;
	}
);
add_action(
	'pre_get_posts',
	function ( WP_Query $q ) {
		if ( is_admin() && $q->is_main_query() && BP_SC_TYPE === $q->get( 'post_type' ) && ! empty( $_GET['bp_status'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$q->set( 'meta_key', '_bp_sc_status' );
			$q->set( 'meta_value', sanitize_key( $_GET['bp_status'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		}
	}
);

// Menu badge with the number of open comments.
add_action(
	'admin_menu',
	function () {
		global $menu;
		$open = count( get_posts( array( 'post_type' => BP_SC_TYPE, 'fields' => 'ids', 'posts_per_page' => -1, 'meta_key' => '_bp_sc_status', 'meta_value' => 'open' ) ) ); // phpcs:ignore WordPress.DB.SlowDBQuery
		if ( ! $open ) {
			return;
		}
		foreach ( $menu as &$item ) {
			if ( 'edit.php?post_type=' . BP_SC_TYPE === $item[2] ) {
				$item[0] .= ' <span class="awaiting-mod"><span class="pending-count">' . (int) $open . '</span></span>';
			}
		}
	},
	99
);

// The single edit screen is not useful for these; send people to the page instead.
add_action(
	'load-post.php',
	function () {
		$id = (int) ( $_GET['post'] ?? 0 ); // phpcs:ignore WordPress.Security.NonceVerification
		if ( $id && BP_SC_TYPE === get_post_type( $id ) ) {
			$page = (string) get_post_meta( $id, '_bp_sc_page_url', true );
			wp_safe_redirect( $page ? add_query_arg( 'bp-comment', $id, $page ) : admin_url( 'edit.php?post_type=' . BP_SC_TYPE ) );
			exit;
		}
	}
);
add_filter( 'post_row_actions', fn( $a, $p ) => BP_SC_TYPE === $p->post_type ? array() : $a, 10, 2 );
