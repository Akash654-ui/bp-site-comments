<?php
/**
 * Runs when the plugin is deleted from Plugins (not when it is only deactivated).
 * Removes every stored site comment. Keep them by adding this to wp-config.php:
 *   define( 'BP_SC_KEEP_DATA', true );
 *
 * @package BP_Site_Comments
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( defined( 'BP_SC_KEEP_DATA' ) && BP_SC_KEEP_DATA ) {
	return;
}

$bp_sc_ids = get_posts(
	array(
		'post_type'      => 'bp_site_comment',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);
foreach ( $bp_sc_ids as $bp_sc_id ) {
	wp_delete_post( $bp_sc_id, true );
}
