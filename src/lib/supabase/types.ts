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
  highest_bidder_id: string | null;
  winning_bid: number | null;
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

export type LotImageRow = {
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

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
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
