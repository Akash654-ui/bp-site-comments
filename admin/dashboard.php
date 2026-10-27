<?php
/**
 * Site Comments dashboard: wp-admin › Site Comments.
 * Replaces WordPress's generic post list with a review screen built for feedback:
 * what needs attention, filters, comments grouped by page with their threads, quick actions.
 * The page is rendered by admin/dashboard.js from the plugin's REST API; this file registers
 * the menu, sends the old list there and prints the shell.
 *
 * @package BP_Site_Comments
 */

defined( 'ABSPATH' ) || exit;

/** The dashboard's address. */
function bp_sc_dashboard_url( array $args = array() ): string {
	return add_query_arg( $args, admin_url( 'admin.php?page=bp-site-comments' ) );
}

/** Number of open comments (menu badge, header). */
function bp_sc_open_count(): int {
	return count(
		get_posts(
			array(
				'post_type'      => BP_SC_TYPE,
				'post_status'    => 'publish',
				'fields'         => 'ids',
				'posts_per_page' => -1,
				'meta_key'       => '_bp_sc_status', // phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_value'     => 'open', // phpcs:ignore WordPress.DB.SlowDBQuery
			)
		)
	);
}

add_action(
	'admin_menu',
	function () {
		$open  = bp_sc_open_count();
		$badge = $open ? ' <span class="awaiting-mod count-' . $open . '"><span class="pending-count">' . number_format_i18n( $open ) . '</span></span>' : '';
		add_menu_page(
			__( 'Site Comments', 'bp-site-comments' ),
			__( 'Site Comments', 'bp-site-comments' ) . $badge,
			'edit_posts',
			'bp-site-comments',
			'bp_sc_render_dashboard',
			'dashicons-format-chat',
			26
		);
	}
);

// The old post list (and its "Open/Resolved" filters) now lives in the dashboard. The Trash stays
// on WordPress's own screen, where Restore and Delete Permanently already work.
add_action(
	'load-edit.php',
	function () {
		if ( BP_SC_TYPE !== ( $_GET['post_type'] ?? '' ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		if ( 'trash' === ( $_GET['post_status'] ?? '' ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			// An empty Trash (for example after deleting the last comments in it) is just a blank WordPress list:
			// go back to the dashboard and say so there.
			if ( ! (int) ( wp_count_posts( BP_SC_TYPE )->trash ?? 0 ) ) {
				$deleted = absint( $_GET['deleted'] ?? 0 ); // phpcs:ignore WordPress.Security.NonceVerification
				wp_safe_redirect( bp_sc_dashboard_url( $deleted ? array( 'removed' => $deleted ) : array( 'trash' => 'empty' ) ) );
				exit;
			}
			return;
		}
		$status = sanitize_key( $_GET['bp_status'] ?? '' ); // phpcs:ignore WordPress.Security.NonceVerification
		wp_safe_redirect( bp_sc_dashboard_url( $status ? array( 'status' => $status ) : array() ) );
		exit;
	}
);

// On the Trash screen, keep Site Comments highlighted in the menu and offer the way back.
add_filter(
	'parent_file',
	function ( $parent ) {
		$screen = get_current_screen();
		return $screen && BP_SC_TYPE === $screen->post_type ? 'bp-site-comments' : $parent;
	}
);
add_action(
	'all_admin_notices',
	function () {
		$screen = get_current_screen();
		if ( $screen && 'edit-' . BP_SC_TYPE === $screen->id ) {
			printf(
				'<p style="margin:16px 0 0"><a href="%s">&larr; %s</a></p>',
				esc_url( bp_sc_dashboard_url() ),
				esc_html__( 'Back to Site Comments', 'bp-site-comments' )
			);
		}
	}
);

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( 'toplevel_page_bp-site-comments' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'bp-sc-dashboard', BP_SC_URL . 'admin/dashboard.css', array(), BP_SC_VERSION );
		wp_enqueue_script( 'bp-sc-dashboard', BP_SC_URL . 'admin/dashboard.js', array(), BP_SC_VERSION, array( 'in_footer' => true ) );
		$trash = wp_count_posts( BP_SC_TYPE );
		wp_localize_script(
			'bp-sc-dashboard',
			'bpScDashboard',
			array(
				'api'      => esc_url_raw( rest_url( 'bp-site-comments/v1/comments' ) ),
				'nonce'    => wp_create_nonce( 'wp_rest' ),
				'home'     => home_url( '/' ),
				'site'     => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
				'trashUrl' => admin_url( 'edit.php?post_status=trash&post_type=' . BP_SC_TYPE ),
				'trash'    => (int) ( $trash->trash ?? 0 ),
				'manage'   => bp_sc_can_manage(),
				'user'     => wp_get_current_user()->display_name,
			)
		);
	}
);

/** The shell; dashboard.js fills it. Without JavaScript it explains why nothing shows. */
function bp_sc_render_dashboard() {
	?>
	<div class="wrap bpsc" id="bpsc-app">
		<h1 class="screen-reader-text"><?php esc_html_e( 'Site Comments', 'bp-site-comments' ); ?></h1>
		<noscript><div class="notice notice-warning"><p><?php esc_html_e( 'The Site Comments dashboard needs JavaScript.', 'bp-site-comments' ); ?></p></div></noscript>
	</div>
	<?php
}
