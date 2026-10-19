export const lotColumns = "submission_key,id,room_id,seller_id,title,description,condition_report,shipping_info,estimate_low,estimate_high,starting_bid,current_bid,bid_count,minimum_increment,bid_extension_seconds,preview_duration_seconds,first_bid_duration_seconds,requeue_delay_days,status,starts_at,preview_starts_at,bidding_starts_at,ends_at,sold_at,unsold_at,next_eligible_at,queue_position,winning_bid,is_premium,created_at,updated_at" as const;

export const auctionLotColumns = "id,room_id,title,description,condition_report,shipping_info,starting_bid,current_bid,bid_count,minimum_increment,preview_duration_seconds,status,starts_at,preview_starts_at,bidding_starts_at,ends_at,next_eligible_at,queue_position,winning_bid,is_premium,created_at" as const;
export const roomColumns = "id,name,slug,description,image_url,display_order,is_active,created_at" as const;
export const imageColumns = "id,lot_id,storage_path,image_url,alt_text,sort_order,created_at" as const;
