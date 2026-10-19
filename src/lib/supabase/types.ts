export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type LotStatus =
  | "DRAFT"
  | "WAITING"
  | "PREVIEW"
  | "FIRST_BID_WINDOW"
  | "ACTIVE_BIDDING"
  | "SOLD"
  | "UNSOLD"
  | "CANCELLED";

export type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type AuctionRoomRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
};

export type LotRow = {
  submission_key: string | null;
  id: string;
  room_id: string;
  seller_id: string;
  title: string;
  description: string | null;
  condition_report: string | null;
  shipping_info: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  starting_bid: number;
  current_bid: number;
  bid_count: number;
  minimum_increment: number;
  bid_extension_seconds: number;
  preview_duration_seconds: number;
  first_bid_duration_seconds: number;
  requeue_delay_days: number;
  status: LotStatus;
  starts_at: string | null;
  preview_starts_at: string | null;
  bidding_starts_at: string | null;
  ends_at: string | null;
  sold_at: string | null;
  unsold_at: string | null;
  next_eligible_at: string;
  queue_position: number;
  highest_bidder_id?: string | null;
  winning_bid: number | null;
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

export type LotImageRow = {
  storage_path: string | null;
  id: string;
  lot_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
};

export type BidRow = {
  id: string;
  lot_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
};

export type WatchlistRow = {
  id: string;
  user_id: string;
  lot_id: string;
  created_at: string;
};

export type NotificationKind = "WATCHED_LIVE" | "WATCHED_SOLD" | "WATCHED_UNSOLD" | "WON" | "SELLER_LIVE" | "SELLER_SOLD";
export type NotificationRow = {
  id: string;
  user_id: string;
  lot_id: string;
  kind: NotificationKind;
  lot_title: string;
  auction_run: string;
  created_at: string;
  read_at: string | null;
};

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      notifications: TableDefinition<NotificationRow, never, { read_at?: string | null }>;
      profiles: TableDefinition<
        ProfileRow,
        {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        }
      >;
      auction_rooms: TableDefinition<
        AuctionRoomRow,
        {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          image_url?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          image_url?: string | null;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
        }
      >;
      lots: TableDefinition<
        LotRow,
        {
          id?: string;
          room_id: string;
          seller_id: string;
          title: string;
          description?: string | null;
          condition_report?: string | null;
          shipping_info?: string | null;
          estimate_low?: number | null;
          estimate_high?: number | null;
          starting_bid: number;
          current_bid?: number;
          bid_count?: number;
          minimum_increment?: number;
          bid_extension_seconds?: number;
          preview_duration_seconds?: number;
          first_bid_duration_seconds?: number;
          requeue_delay_days?: number;
          status?: LotStatus;
          starts_at?: string | null;
          preview_starts_at?: string | null;
          bidding_starts_at?: string | null;
          ends_at?: string | null;
          sold_at?: string | null;
          unsold_at?: string | null;
          next_eligible_at?: string;
          queue_position?: number;
          highest_bidder_id?: string | null;
          winning_bid?: number | null;
          is_premium?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          room_id?: string;
          seller_id?: string;
          title?: string;
          description?: string | null;
          condition_report?: string | null;
          shipping_info?: string | null;
          estimate_low?: number | null;
          estimate_high?: number | null;
          starting_bid?: number;
          current_bid?: number;
          bid_count?: number;
          minimum_increment?: number;
          bid_extension_seconds?: number;
          preview_duration_seconds?: number;
          first_bid_duration_seconds?: number;
          requeue_delay_days?: number;
          status?: LotStatus;
          starts_at?: string | null;
          preview_starts_at?: string | null;
          bidding_starts_at?: string | null;
          ends_at?: string | null;
          sold_at?: string | null;
          unsold_at?: string | null;
          next_eligible_at?: string;
          queue_position?: number;
          highest_bidder_id?: string | null;
          winning_bid?: number | null;
          is_premium?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      lot_images: TableDefinition<
        LotImageRow,
        {
          id?: string;
          lot_id: string;
          image_url: string;
          alt_text?: string | null;
          sort_order?: number;
          created_at?: string;
        },
        {
          id?: string;
          lot_id?: string;
          image_url?: string;
          alt_text?: string | null;
          sort_order?: number;
          created_at?: string;
        }
      >;
      bids: TableDefinition<
        BidRow,
        {
          id?: string;
          lot_id: string;
          bidder_id: string;
          amount: number;
          created_at?: string;
        },
        {
          id?: string;
          lot_id?: string;
          bidder_id?: string;
          amount?: number;
          created_at?: string;
        }
      >;
      watchlist: TableDefinition<
        WatchlistRow,
        {
          id?: string;
          user_id: string;
          lot_id: string;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          lot_id?: string;
          created_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      completed_auctions_page: { Args: { p_mode: "buyer" | "seller"; p_limit?: number; p_offset?: number; p_lot_id?: string }; Returns: { lot_id: string; title: string; sale_price: number; completed_at: string; seller_name: string; buyer_name: string; is_buyer: boolean; image_url: string | null; storage_path: string | null }[] };
      my_completed_auctions: { Args: Record<string, never>; Returns: { lot_id: string; sale_price: number; completed_at: string; seller_name: string; buyer_name: string; is_buyer: boolean }[] };
      save_seller_draft: { Args: { p_submission_key: string; p_room_id: string; p_title: string; p_description: string; p_starting_bid: number }; Returns: LotRow };
      prepare_seller_photo: { Args: { p_lot_id: string; p_image_id: string; p_extension: string }; Returns: LotImageRow };
      remove_seller_photo: { Args: { p_image_id: string }; Returns: undefined };
      submit_seller_lot: { Args: { p_lot_id: string }; Returns: LotRow };
      discard_seller_draft: { Args: { p_lot_id: string }; Returns: undefined };
      lot_watchlist_count: { Args: { p_lot_id: string }; Returns: number };
      auction_server_time: { Args: Record<string, never>; Returns: string };
      publish_lot: { Args: { p_lot_id: string }; Returns: LotRow };
      advance_lot: {
        Args: {
          p_lot_id: string;
        };
        Returns: LotRow;
      };
      advance_room_lifecycle: {
        Args: {
          p_room_id: string;
        };
        Returns: LotRow;
      };
      place_bid: {
        Args: {
          lot_id: string;
          bid_amount: number;
        };
        Returns: LotRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = ProfileRow;
export type AuctionRoomRecord = AuctionRoomRow;
export type LotRecord = LotRow;
export type LotImage = LotImageRow;
export type Bid = BidRow;
export type WatchlistItem = WatchlistRow;
