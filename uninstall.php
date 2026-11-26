<?php
/**
 * Runs when the plugin is deleted from Plugins (not when it is only deactivated).
 * Removes every stored site comment, including those in the Trash, on every site of a network.
 * Keep them by adding this to wp-config.php:
 *   define( 'BP_SC_KEEP_DATA', true );
 *
 * @package BP_Site_Comments
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( defined( 'BP_SC_KEEP_DATA' ) && BP_SC_KEEP_DATA ) {
	return;
}

/** Deletes this site's comments. */
function bp_sc_uninstall_site() {
	$ids = get_posts(
		array(
			'post_type'      => 'bp_site_comment',
			'post_status'    => array( 'any', 'trash' ), // 'any' alone skips the Trash.
			'posts_per_page' => -1,
			'fields'         => 'ids',
		)
	);
	foreach ( $ids as $id ) {
		wp_delete_post( $id, true );
	}
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) as $bp_sc_site ) {
		switch_to_blog( $bp_sc_site );
		bp_sc_uninstall_site();
		restore_current_blog();
	}
} else {
	bp_sc_uninstall_site();
}
