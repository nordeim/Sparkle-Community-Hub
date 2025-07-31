-- =====================================================
-- Sparkle Universe Complete Database Schema
-- Version 2.0 - Full Feature Implementation
-- =====================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- For exclusion constraints

-- =====================================================
-- ENUMS - Existing + New
-- =====================================================

-- Existing enums
CREATE TYPE user_role AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'CREATOR');
CREATE TYPE notification_type AS ENUM (
  'POST_LIKED',
  'POST_COMMENTED',
  'COMMENT_LIKED',
  'USER_FOLLOWED',
  'ACHIEVEMENT_UNLOCKED',
  'LEVEL_UP',
  'MENTION',
  'SYSTEM',
  'GROUP_INVITE',
  'GROUP_POST',
  'EVENT_REMINDER',
  'WATCH_PARTY_INVITE',
  'DIRECT_MESSAGE',
  'YOUTUBE_PREMIERE',
  'QUEST_COMPLETE',
  'TRADE_REQUEST'
);
CREATE TYPE reaction_type AS ENUM ('LIKE', 'LOVE', 'FIRE', 'SPARKLE', 'MIND_BLOWN', 'LAUGH', 'CRY', 'ANGRY');
CREATE TYPE report_reason AS ENUM ('SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'MISINFORMATION', 'COPYRIGHT', 'OTHER');
CREATE TYPE moderation_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'AUTO_APPROVED');

-- New enums for additional features
CREATE TYPE content_type AS ENUM ('BLOG', 'LIVE_BLOG', 'POLL', 'VIDEO_REVIEW', 'FAN_ART', 'THEORY_THREAD', 'SERIES');
CREATE TYPE badge_rarity AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');
CREATE TYPE quest_type AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'SPECIAL', 'ACHIEVEMENT');
CREATE TYPE quest_status AS ENUM ('AVAILABLE', 'IN_PROGRESS', 'COMPLETED', 'CLAIMED', 'EXPIRED');
CREATE TYPE trade_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE message_status AS ENUM ('SENT', 'DELIVERED', 'READ');
CREATE TYPE event_type AS ENUM ('WATCH_PARTY', 'COMMUNITY_MEETUP', 'CONTEST', 'PREMIERE', 'AMA', 'SPECIAL');
CREATE TYPE group_visibility AS ENUM ('PUBLIC', 'PRIVATE', 'INVITE_ONLY');
CREATE TYPE group_member_role AS ENUM ('MEMBER', 'MODERATOR', 'ADMIN', 'OWNER');

-- =====================================================
-- CORE TABLES - Existing with enhancements
-- =====================================================

-- Users table (enhanced)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),
  email_verified TIMESTAMP,
  image VARCHAR(500),
  bio TEXT,
  role user_role DEFAULT 'USER',
  verified BOOLEAN DEFAULT FALSE,
  banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  ban_expires_at TIMESTAMP,
  experience INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  sparkle_points INTEGER DEFAULT 0, -- Virtual currency
  premium_points INTEGER DEFAULT 0, -- Premium currency
  last_seen_at TIMESTAMP,
  online_status BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_users_email (email),
  INDEX idx_users_username (username),
  INDEX idx_users_role (role),
  INDEX idx_users_level (level),
  INDEX idx_users_online_status (online_status),
  INDEX idx_users_sparkle_points (sparkle_points)
);

-- User profiles (enhanced)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100),
  location VARCHAR(100),
  website VARCHAR(255),
  twitter_username VARCHAR(50),
  youtube_channel_id VARCHAR(100),
  youtube_channel_url VARCHAR(255),
  youtube_channel_data JSONB, -- Cached channel data
  banner_image VARCHAR(500),
  theme_preference JSONB,
  notification_settings JSONB DEFAULT '{}',
  privacy_settings JSONB DEFAULT '{}',
  featured_badges UUID[], -- Array of achievement IDs to showcase
  custom_css TEXT, -- For profile customization
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_profiles_user_id (user_id),
  INDEX idx_profiles_youtube_channel_id (youtube_channel_id)
);

-- OAuth accounts (unchanged)
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type VARCHAR(50),
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(provider, provider_account_id),
  INDEX idx_accounts_user_id (user_id)
);

-- Sessions (unchanged)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_token (session_token)
);

-- Categories (was missing, now added)
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(7),
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  post_count INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_categories_slug (slug),
  INDEX idx_categories_parent_id (parent_id)
);

-- Posts (enhanced for multiple content types)
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  title VARCHAR(500) NOT NULL,
  content JSONB NOT NULL, -- Changed to JSONB for rich content
  content_type content_type DEFAULT 'BLOG',
  excerpt TEXT,
  cover_image VARCHAR(500),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  series_id UUID REFERENCES post_series(id) ON DELETE SET NULL,
  series_order INTEGER,
  published BOOLEAN DEFAULT FALSE,
  featured BOOLEAN DEFAULT FALSE,
  is_draft BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  parent_version_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  youtube_video_id VARCHAR(50),
  youtube_video_data JSONB, -- Cached video metadata
  views INTEGER DEFAULT 0,
  reading_time INTEGER,
  meta_description TEXT,
  scheduled_publish_at TIMESTAMP,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_posts_slug (slug),
  INDEX idx_posts_author_id (author_id),
  INDEX idx_posts_category_id (category_id),
  INDEX idx_posts_series_id (series_id),
  INDEX idx_posts_published (published, published_at DESC),
  INDEX idx_posts_featured (featured),
  INDEX idx_posts_content_type (content_type),
  INDEX idx_posts_scheduled (scheduled_publish_at)
);

-- Post series/collections
CREATE TABLE post_series (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_image VARCHAR(500),
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_post_series_author_id (author_id),
  INDEX idx_post_series_slug (slug)
);

-- Tags (unchanged)
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  color VARCHAR(7),
  post_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_tags_name (name),
  INDEX idx_tags_slug (slug)
);

-- Post tags (unchanged)
CREATE TABLE post_tags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (post_id, tag_id),
  INDEX idx_post_tags_post_id (post_id),
  INDEX idx_post_tags_tag_id (tag_id)
);

-- Comments (enhanced)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  youtube_timestamp INTEGER, -- For timestamp-based discussions
  edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP,
  deleted BOOLEAN DEFAULT FALSE,
  pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_comments_post_id (post_id),
  INDEX idx_comments_author_id (author_id),
  INDEX idx_comments_parent_id (parent_id),
  INDEX idx_comments_youtube_timestamp (youtube_timestamp)
);

-- Reactions (unchanged)
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type reaction_type NOT NULL,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure one reaction per user per content
  UNIQUE(post_id, user_id, type),
  UNIQUE(comment_id, user_id, type),
  
  -- Ensure reaction is for post OR comment, not both
  CONSTRAINT chk_reaction_target CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NOT NULL)
  ),
  
  INDEX idx_reactions_post_id (post_id),
  INDEX idx_reactions_comment_id (comment_id),
  INDEX idx_reactions_user_id (user_id)
);

-- Follows (unchanged)
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(follower_id, following_id),
  CONSTRAINT chk_no_self_follow CHECK (follower_id != following_id),
  
  INDEX idx_follows_follower_id (follower_id),
  INDEX idx_follows_following_id (following_id)
);

-- Notifications (enhanced)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type notification_type NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_id VARCHAR(100),
  entity_type VARCHAR(50),
  message TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  email_sent BOOLEAN DEFAULT FALSE,
  push_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_notifications_user_id (user_id, read, created_at DESC),
  INDEX idx_notifications_actor_id (actor_id),
  INDEX idx_notifications_type (type)
);

-- =====================================================
-- GAMIFICATION TABLES
-- =====================================================

-- Achievements (enhanced)
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  animated_icon VARCHAR(255), -- For special animations
  xp_reward INTEGER DEFAULT 0,
  sparkle_points_reward INTEGER DEFAULT 0,
  rarity badge_rarity DEFAULT 'COMMON',
  category VARCHAR(50),
  criteria JSONB,
  display_order INTEGER DEFAULT 0,
  seasonal BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User achievements (unchanged)
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  progress JSONB,
  showcased BOOLEAN DEFAULT FALSE, -- Featured on profile
  
  UNIQUE(user_id, achievement_id),
  INDEX idx_user_achievements_user_id (user_id),
  INDEX idx_user_achievements_showcased (user_id, showcased)
);

-- XP logs (unchanged)
CREATE TABLE xp_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_xp_logs_user_id (user_id, created_at DESC)
);

-- Virtual currency transactions
CREATE TABLE currency_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  currency_type VARCHAR(20) NOT NULL, -- 'sparkle_points' or 'premium_points'
  transaction_type VARCHAR(50) NOT NULL, -- 'earned', 'spent', 'gifted', 'refunded'
  description TEXT,
  reference_id UUID, -- ID of related entity (purchase, gift, etc)
  reference_type VARCHAR(50), -- Type of related entity
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_currency_transactions_user_id (user_id, created_at DESC),
  INDEX idx_currency_transactions_type (transaction_type)
);

-- Virtual store items
CREATE TABLE store_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL, -- 'theme', 'badge', 'reaction', 'profile_effect'
  price_sparkle INTEGER,
  price_premium INTEGER,
  discount_percentage INTEGER DEFAULT 0,
  preview_url VARCHAR(500),
  data JSONB, -- Item-specific data (CSS, animation data, etc)
  limited_edition BOOLEAN DEFAULT FALSE,
  stock_remaining INTEGER,
  available_from TIMESTAMP,
  available_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_store_items_category (category),
  INDEX idx_store_items_available (available_from, available_until)
);

-- User inventory
CREATE TABLE user_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  equipped BOOLEAN DEFAULT FALSE,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  
  UNIQUE(user_id, item_id),
  INDEX idx_user_inventory_user_id (user_id),
  INDEX idx_user_inventory_equipped (user_id, equipped)
);

-- Trading system
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status trade_status DEFAULT 'PENDING',
  initiator_items UUID[], -- Array of inventory item IDs
  recipient_items UUID[], -- Array of inventory item IDs
  initiator_points INTEGER DEFAULT 0,
  recipient_points INTEGER DEFAULT 0,
  message TEXT,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_trades_initiator (initiator_id, status),
  INDEX idx_trades_recipient (recipient_id, status)
);

-- Daily quests
CREATE TABLE quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type quest_type NOT NULL,
  requirements JSONB NOT NULL, -- Dynamic quest requirements
  rewards JSONB NOT NULL, -- XP, points, items
  available_from TIMESTAMP,
  available_until TIMESTAMP,
  max_completions INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User quest progress
CREATE TABLE user_quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  status quest_status DEFAULT 'AVAILABLE',
  progress JSONB DEFAULT '{}',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  claimed_at TIMESTAMP,
  
  UNIQUE(user_id, quest_id),
  INDEX idx_user_quests_user_id (user_id, status),
  INDEX idx_user_quests_status (status)
);

-- Leaderboards
CREATE TABLE leaderboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL, -- 'weekly_xp', 'monthly_posts', 'all_time_reactions'
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  data JSONB NOT NULL, -- Top users with scores
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(type, period_start, period_end),
  INDEX idx_leaderboards_type (type, period_end DESC)
);

-- =====================================================
-- YOUTUBE INTEGRATION TABLES
-- =====================================================

-- YouTube channels tracking
CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel_title VARCHAR(255),
  channel_data JSONB, -- Full channel metadata
  subscriber_count INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  last_video_id VARCHAR(50),
  last_video_published_at TIMESTAMP,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_youtube_channels_user_id (user_id),
  INDEX idx_youtube_channels_channel_id (channel_id)
);

-- YouTube video metadata cache
CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id VARCHAR(50) UNIQUE NOT NULL,
  channel_id VARCHAR(100) NOT NULL,
  title VARCHAR(500),
  description TEXT,
  thumbnail_url VARCHAR(500),
  duration INTEGER, -- in seconds
  view_count BIGINT DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  published_at TIMESTAMP,
  metadata JSONB, -- Full video data
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_youtube_videos_channel_id (channel_id),
  INDEX idx_youtube_videos_published_at (published_at DESC)
);

-- Watch parties
CREATE TABLE watch_parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  youtube_video_id VARCHAR(50) NOT NULL,
  scheduled_start TIMESTAMP NOT NULL,
  actual_start TIMESTAMP,
  ended_at TIMESTAMP,
  max_participants INTEGER DEFAULT 50,
  is_public BOOLEAN DEFAULT TRUE,
  chat_enabled BOOLEAN DEFAULT TRUE,
  sync_playback BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_watch_parties_host_id (host_id),
  INDEX idx_watch_parties_scheduled (scheduled_start),
  INDEX idx_watch_parties_public (is_public, scheduled_start)
);

-- Watch party participants
CREATE TABLE watch_party_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  playback_position INTEGER DEFAULT 0, -- Current position in seconds
  
  UNIQUE(party_id, user_id),
  INDEX idx_watch_party_participants_party (party_id, is_active),
  INDEX idx_watch_party_participants_user (user_id)
);

-- YouTube video clips
CREATE TABLE video_clips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  youtube_video_id VARCHAR(50) NOT NULL,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  start_time INTEGER NOT NULL, -- Start timestamp in seconds
  end_time INTEGER NOT NULL, -- End timestamp in seconds
  description TEXT,
  tags VARCHAR(50)[],
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_video_clips_video_id (youtube_video_id),
  INDEX idx_video_clips_creator_id (creator_id)
);

-- Collaborative playlists
CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_collaborative BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT TRUE,
  cover_image VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_playlists_owner_id (owner_id),
  INDEX idx_playlists_public (is_public)
);

-- Playlist items
CREATE TABLE playlist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  youtube_video_id VARCHAR(50) NOT NULL,
  added_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  note TEXT,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(playlist_id, position),
  INDEX idx_playlist_items_playlist (playlist_id),
  INDEX idx_playlist_items_added_by (added_by)
);

-- =====================================================
-- SOCIAL FEATURES TABLES
-- =====================================================

-- Groups/Clubs
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  banner_image VARCHAR(500),
  icon VARCHAR(500),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility group_visibility DEFAULT 'PUBLIC',
  member_count INTEGER DEFAULT 1,
  post_count INTEGER DEFAULT 0,
  rules TEXT,
  tags VARCHAR(50)[],
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_groups_slug (slug),
  INDEX idx_groups_owner_id (owner_id),
  INDEX idx_groups_visibility (visibility)
);

-- Group memberships
CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role group_member_role DEFAULT 'MEMBER',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  UNIQUE(group_id, user_id),
  INDEX idx_group_members_group (group_id, role),
  INDEX idx_group_members_user (user_id)
);

-- Events calendar
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type event_type NOT NULL,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  location_name VARCHAR(255),
  location_url VARCHAR(500), -- For online events
  banner_image VARCHAR(500),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  max_attendees INTEGER,
  is_public BOOLEAN DEFAULT TRUE,
  requires_approval BOOLEAN DEFAULT FALSE,
  tags VARCHAR(50)[],
  metadata JSONB, -- Event-specific data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_events_host_id (host_id),
  INDEX idx_events_group_id (group_id),
  INDEX idx_events_start_time (start_time),
  INDEX idx_events_public (is_public, start_time)
);

-- Event attendees
CREATE TABLE event_attendees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'INTERESTED', -- 'INTERESTED', 'GOING', 'MAYBE', 'NOT_GOING'
  approved BOOLEAN DEFAULT TRUE,
  check_in_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(event_id, user_id),
  INDEX idx_event_attendees_event (event_id, status),
  INDEX idx_event_attendees_user (user_id)
);

-- Direct message conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  is_group BOOLEAN DEFAULT FALSE,
  title VARCHAR(255), -- For group conversations
  encrypted_key TEXT, -- For E2E encryption
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_conversations_created_by (created_by)
);

-- Conversation participants
CREATE TABLE conversation_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP,
  is_admin BOOLEAN DEFAULT FALSE,
  last_read_at TIMESTAMP,
  notifications_muted BOOLEAN DEFAULT FALSE,
  
  UNIQUE(conversation_id, user_id),
  INDEX idx_conversation_participants_conv (conversation_id),
  INDEX idx_conversation_participants_user (user_id)
);

-- Direct messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT, -- Encrypted content
  message_type VARCHAR(20) DEFAULT 'TEXT', -- 'TEXT', 'IMAGE', 'VIDEO', 'FILE'
  metadata JSONB, -- File URLs, image dimensions, etc
  edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP,
  deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_messages_conversation (conversation_id, created_at DESC),
  INDEX idx_messages_sender (sender_id)
);

-- Message read receipts
CREATE TABLE message_reads (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (message_id, user_id),
  INDEX idx_message_reads_user (user_id)
);

-- =====================================================
-- REAL-TIME SUPPORT TABLES
-- =====================================================

-- Active WebSocket sessions
CREATE TABLE websocket_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  socket_id VARCHAR(255) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_ping_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_websocket_sessions_user (user_id),
  INDEX idx_websocket_sessions_socket (socket_id)
);

-- Chat rooms
CREATE TABLE chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  topic VARCHAR(100),
  is_public BOOLEAN DEFAULT TRUE,
  max_users INTEGER DEFAULT 100,
  active_users INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_chat_rooms_slug (slug),
  INDEX idx_chat_rooms_public (is_public)
);

-- Chat messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  edited BOOLEAN DEFAULT FALSE,
  deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_chat_messages_room (room_id, created_at DESC),
  INDEX idx_chat_messages_user (user_id)
);

-- Collaborative spaces
CREATE TABLE collaborative_spaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL, -- 'document', 'canvas', 'playlist'
  title VARCHAR(255) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content JSONB,
  version INTEGER DEFAULT 1,
  is_public BOOLEAN DEFAULT FALSE,
  max_collaborators INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_collaborative_spaces_owner (owner_id),
  INDEX idx_collaborative_spaces_type (type)
);

-- Collaborators
CREATE TABLE space_collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES collaborative_spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit BOOLEAN DEFAULT TRUE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(space_id, user_id),
  INDEX idx_space_collaborators_space (space_id),
  INDEX idx_space_collaborators_user (user_id)
);

-- Activity streams
CREATE TABLE activity_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  visibility VARCHAR(20) DEFAULT 'PUBLIC', -- 'PUBLIC', 'FOLLOWERS', 'PRIVATE'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_activity_streams_user (user_id, created_at DESC),
  INDEX idx_activity_streams_entity (entity_type, entity_id)
);

-- =====================================================
-- CONTENT VARIATION TABLES
-- =====================================================

-- Polls
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID UNIQUE NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  multiple_choice BOOLEAN DEFAULT FALSE,
  anonymous_voting BOOLEAN DEFAULT FALSE,
  close_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_polls_post_id (post_id)
);

-- Poll options
CREATE TABLE poll_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  vote_count INTEGER DEFAULT 0,
  
  INDEX idx_poll_options_poll_id (poll_id)
);

-- Poll votes
CREATE TABLE poll_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(poll_id, user_id, option_id),
  INDEX idx_poll_votes_poll_id (poll_id),
  INDEX idx_poll_votes_user_id (user_id)
);

-- Fan art galleries
CREATE TABLE fan_art_galleries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID UNIQUE NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  submission_deadline TIMESTAMP,
  voting_enabled BOOLEAN DEFAULT TRUE,
  max_submissions_per_user INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fan art submissions
CREATE TABLE fan_art_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gallery_id UUID NOT NULL REFERENCES fan_art_galleries(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  vote_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_fan_art_gallery (gallery_id),
  INDEX idx_fan_art_artist (artist_id)
);

-- =====================================================
-- ADDITIONAL SUPPORT TABLES
-- =====================================================

-- Media files tracking
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_type VARCHAR(50) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100),
  original_name VARCHAR(255),
  storage_path VARCHAR(500) NOT NULL,
  cdn_url VARCHAR(500),
  thumbnail_url VARCHAR(500),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_media_files_user (user_id),
  INDEX idx_media_files_type (file_type)
);

-- A/B testing experiments
CREATE TABLE experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  hypothesis TEXT,
  variants JSONB NOT NULL,
  targeting_rules JSONB,
  traffic_percentage INTEGER DEFAULT 100,
  status VARCHAR(20) DEFAULT 'DRAFT', -- 'DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED'
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_experiments_status (status),
  INDEX idx_experiments_dates (started_at, ended_at)
);

-- Experiment assignments
CREATE TABLE experiment_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant VARCHAR(50) NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(experiment_id, user_id),
  INDEX idx_experiment_assignments_exp (experiment_id),
  INDEX idx_experiment_assignments_user (user_id)
);

-- AI moderation queue
CREATE TABLE ai_moderation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  content TEXT,
  ai_score FLOAT, -- 0-1 confidence score
  ai_reasons JSONB,
  human_review_required BOOLEAN DEFAULT FALSE,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_decision VARCHAR(20), -- 'APPROVED', 'REJECTED', 'EDITED'
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  
  INDEX idx_ai_moderation_pending (human_review_required, created_at),
  INDEX idx_ai_moderation_entity (entity_type, entity_id)
);

-- =====================================================
-- EXISTING TABLES (unchanged from original schema)
-- =====================================================

-- Reports (unchanged)
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason report_reason NOT NULL,
  description TEXT,
  status moderation_status DEFAULT 'PENDING',
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP,
  resolution_note TEXT,
  
  -- Polymorphic relation
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_reports_status (status),
  INDEX idx_reports_entity (entity_type, entity_id)
);

-- Site settings (unchanged)
CREATE TABLE site_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  category VARCHAR(50),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Feature flags (unchanged)
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag VARCHAR(100) UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  conditions JSONB,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analytics events (unchanged)
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(100),
  properties JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_analytics_events_name (event_name, timestamp DESC),
  INDEX idx_analytics_events_user_id (user_id),
  INDEX idx_analytics_events_session_id (session_id)
);

-- Search index queue (unchanged)
CREATE TABLE search_index_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete'
  processed BOOLEAN DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  
  INDEX idx_search_queue_processed (processed, created_at)
);

-- =====================================================
-- FUNCTIONS - Existing + New
-- =====================================================

-- Update timestamp function (unchanged)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update post count for tags (unchanged)
CREATE OR REPLACE FUNCTION update_tag_post_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET post_count = post_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET post_count = post_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate user level from XP (unchanged)
CREATE OR REPLACE FUNCTION calculate_user_level(xp INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN FLOOR(SQRT(xp::FLOAT / 100)) + 1;
END;
$$ LANGUAGE plpgsql;

-- Function to check and unlock achievements (enhanced)
CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID, p_trigger VARCHAR)
RETURNS TABLE(achievement_id UUID, achievement_name VARCHAR, xp_reward INTEGER, points_reward INTEGER) AS $$
DECLARE
  v_achievement RECORD;
  v_unlocked BOOLEAN;
  v_user_stats RECORD;
BEGIN
  -- Get user stats for criteria checking
  SELECT * INTO v_user_stats FROM users WHERE id = p_user_id;
  
  FOR v_achievement IN 
    SELECT a.* FROM achievements a
    WHERE a.criteria->>'trigger' = p_trigger
    AND NOT EXISTS (
      SELECT 1 FROM user_achievements ua 
      WHERE ua.user_id = p_user_id AND ua.achievement_id = a.id
    )
  LOOP
    -- Check criteria (simplified, would be more complex in reality)
    v_unlocked := TRUE;
    
    IF v_unlocked THEN
      INSERT INTO user_achievements (user_id, achievement_id)
      VALUES (p_user_id, v_achievement.id);
      
      -- Update user XP and points
      UPDATE users 
      SET experience = experience + v_achievement.xp_reward,
          sparkle_points = sparkle_points + v_achievement.sparkle_points_reward
      WHERE id = p_user_id;
      
      RETURN QUERY SELECT v_achievement.id, v_achievement.name, 
                         v_achievement.xp_reward, v_achievement.sparkle_points_reward;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to update user level when XP changes
CREATE OR REPLACE FUNCTION update_user_level()
RETURNS TRIGGER AS $$
DECLARE
  v_new_level INTEGER;
BEGIN
  v_new_level := calculate_user_level(NEW.experience);
  
  IF v_new_level != NEW.level THEN
    NEW.level := v_new_level;
    
    -- Create level up notification
    INSERT INTO notifications (type, user_id, message, data)
    VALUES ('LEVEL_UP', NEW.id, 
            'Congratulations! You reached level ' || v_new_level || '!',
            jsonb_build_object('old_level', OLD.level, 'new_level', v_new_level));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update group member count
CREATE OR REPLACE FUNCTION update_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE groups SET member_count = member_count - 1 WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to handle currency transactions
CREATE OR REPLACE FUNCTION process_currency_transaction(
  p_user_id UUID,
  p_amount INTEGER,
  p_currency_type VARCHAR,
  p_transaction_type VARCHAR,
  p_description TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type VARCHAR DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Get current balance
  IF p_currency_type = 'sparkle_points' THEN
    SELECT sparkle_points INTO v_current_balance FROM users WHERE id = p_user_id;
  ELSIF p_currency_type = 'premium_points' THEN
    SELECT premium_points INTO v_current_balance FROM users WHERE id = p_user_id;
  ELSE
    RETURN FALSE;
  END IF;
  
  -- Calculate new balance
  IF p_transaction_type IN ('spent', 'gifted') THEN
    v_new_balance := v_current_balance - p_amount;
    IF v_new_balance < 0 THEN
      RETURN FALSE; -- Insufficient funds
    END IF;
  ELSE
    v_new_balance := v_current_balance + p_amount;
  END IF;
  
  -- Update balance
  IF p_currency_type = 'sparkle_points' THEN
    UPDATE users SET sparkle_points = v_new_balance WHERE id = p_user_id;
  ELSE
    UPDATE users SET premium_points = v_new_balance WHERE id = p_user_id;
  END IF;
  
  -- Log transaction
  INSERT INTO currency_transactions 
    (user_id, amount, currency_type, transaction_type, description, 
     reference_id, reference_type, balance_after)
  VALUES 
    (p_user_id, p_amount, p_currency_type, p_transaction_type, p_description,
     p_reference_id, p_reference_type, v_new_balance);
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired data
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS void AS $$
BEGIN
  -- Remove expired trades
  UPDATE trades SET status = 'EXPIRED' 
  WHERE status = 'PENDING' AND expires_at < CURRENT_TIMESTAMP;
  
  -- Remove expired quests
  UPDATE user_quests SET status = 'EXPIRED'
  WHERE status IN ('AVAILABLE', 'IN_PROGRESS') 
  AND quest_id IN (
    SELECT id FROM quests WHERE available_until < CURRENT_TIMESTAMP
  );
  
  -- Remove old WebSocket sessions
  DELETE FROM websocket_sessions 
  WHERE last_ping_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes';
  
  -- Update user online status
  UPDATE users SET online_status = FALSE
  WHERE online_status = TRUE 
  AND last_seen_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS - Existing + New
-- =====================================================

-- Create triggers for updated_at (existing tables)
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create triggers for updated_at (new tables)
CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watch_parties_updated_at BEFORE UPDATE ON watch_parties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collaborative_spaces_updated_at BEFORE UPDATE ON collaborative_spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_store_items_updated_at BEFORE UPDATE ON store_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_experiments_updated_at BEFORE UPDATE ON experiments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tag post count trigger (unchanged)
CREATE TRIGGER update_tag_counts
AFTER INSERT OR DELETE ON post_tags
FOR EACH ROW EXECUTE FUNCTION update_tag_post_count();

-- User level trigger
CREATE TRIGGER check_user_level
BEFORE UPDATE OF experience ON users
FOR EACH ROW EXECUTE FUNCTION update_user_level();

-- Group member count trigger
CREATE TRIGGER update_group_members
AFTER INSERT OR DELETE ON group_members
FOR EACH ROW EXECUTE FUNCTION update_group_member_count();

-- =====================================================
-- MATERIALIZED VIEWS - Existing + New
-- =====================================================

-- Trending posts (unchanged)
CREATE MATERIALIZED VIEW trending_posts AS
SELECT 
  p.id,
  p.slug,
  p.title,
  p.author_id,
  p.created_at,
  COUNT(DISTINCT r.user_id) AS reaction_count,
  COUNT(DISTINCT c.id) AS comment_count,
  p.views,
  (
    COUNT(DISTINCT r.user_id) * 3 + 
    COUNT(DISTINCT c.id) * 2 + 
    p.views * 0.1 +
    CASE WHEN p.created_at > NOW() - INTERVAL '7 days' THEN 10 ELSE 0 END
  ) AS trending_score
FROM posts p
LEFT JOIN reactions r ON r.post_id = p.id
LEFT JOIN comments c ON c.post_id = p.id
WHERE p.published = TRUE
  AND p.created_at > NOW() - INTERVAL '30 days'
GROUP BY p.id;

CREATE INDEX idx_trending_posts_score ON trending_posts(trending_score DESC);

-- Top creators view
CREATE MATERIALIZED VIEW top_creators AS
SELECT 
  u.id,
  u.username,
  u.image,
  COUNT(DISTINCT p.id) AS post_count,
  COUNT(DISTINCT f.follower_id) AS follower_count,
  SUM(p.views) AS total_views,
  AVG(p.views) AS avg_views_per_post,
  COUNT(DISTINCT r.user_id) AS total_reactions
FROM users u
LEFT JOIN posts p ON p.author_id = u.id AND p.published = TRUE
LEFT JOIN follows f ON f.following_id = u.id
LEFT JOIN reactions r ON r.post_id = p.id
WHERE u.role IN ('USER', 'CREATOR', 'MODERATOR', 'ADMIN')
GROUP BY u.id
HAVING COUNT(DISTINCT p.id) > 0;

CREATE INDEX idx_top_creators_followers ON top_creators(follower_count DESC);

-- Active groups view
CREATE MATERIALIZED VIEW active_groups AS
SELECT 
  g.id,
  g.name,
  g.slug,
  g.member_count,
  COUNT(DISTINCT p.id) AS posts_last_week,
  MAX(p.created_at) AS last_activity
FROM groups g
LEFT JOIN posts p ON p.author_id IN (
  SELECT user_id FROM group_members WHERE group_id = g.id
) AND p.created_at > NOW() - INTERVAL '7 days'
WHERE g.visibility = 'PUBLIC'
GROUP BY g.id
ORDER BY posts_last_week DESC, g.member_count DESC;

-- =====================================================
-- FUNCTIONS FOR MATERIALIZED VIEW REFRESH
-- =====================================================

-- Refresh trending posts every hour (unchanged)
CREATE OR REPLACE FUNCTION refresh_trending_posts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY trending_posts;
END;
$$ LANGUAGE plpgsql;

-- Refresh top creators daily
CREATE OR REPLACE FUNCTION refresh_top_creators()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY top_creators;
END;
$$ LANGUAGE plpgsql;

-- Refresh active groups hourly
CREATE OR REPLACE FUNCTION refresh_active_groups()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY active_groups;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- INITIAL DATA SEEDING
-- =====================================================

-- Insert default categories
INSERT INTO categories (name, slug, description, icon, color, display_order) VALUES
('General Discussion', 'general', 'General topics about Sparkle', 'chat', '#6B7280', 1),
('Videos & Reactions', 'videos', 'Discuss Sparkle videos', 'video', '#EF4444', 2),
('Fan Creations', 'fan-creations', 'Share your fan art and creations', 'palette', '#8B5CF6', 3),
('Theories & Speculation', 'theories', 'Share your theories', 'lightbulb', '#F59E0B', 4),
('Events & Meetups', 'events', 'Community events and gatherings', 'calendar', '#10B981', 5),
('Tech Support', 'support', 'Get help with technical issues', 'help-circle', '#3B82F6', 6);

-- Insert default achievements
INSERT INTO achievements (code, name, description, icon, xp_reward, sparkle_points_reward, rarity, category) VALUES
('first_post', 'First Post', 'Create your first post', 'edit', 100, 50, 'COMMON', 'content'),
('first_comment', 'First Comment', 'Leave your first comment', 'message', 50, 25, 'COMMON', 'engagement'),
('welcome_wagon', 'Welcome Wagon', 'Complete your profile', 'user-check', 100, 50, 'COMMON', 'profile'),
('social_butterfly', 'Social Butterfly', 'Follow 10 users', 'users', 200, 100, 'UNCOMMON', 'social'),
('rising_star', 'Rising Star', 'Receive 100 reactions on your posts', 'star', 500, 250, 'RARE', 'content'),
('super_fan', 'Super Fan', 'Join 5 watch parties', 'tv', 300, 150, 'UNCOMMON', 'youtube'),
('collector', 'Collector', 'Unlock 25 achievements', 'award', 1000, 500, 'EPIC', 'meta');

-- Insert default site settings
INSERT INTO site_settings (key, value, category, description) VALUES
('maintenance_mode', 'false'::jsonb, 'system', 'Enable maintenance mode'),
('registration_enabled', 'true'::jsonb, 'auth', 'Allow new user registrations'),
('max_upload_size', '10485760'::jsonb, 'media', 'Maximum file upload size in bytes'),
('posts_per_page', '20'::jsonb, 'display', 'Number of posts per page'),
('enable_watch_parties', 'true'::jsonb, 'features', 'Enable watch party feature'),
('enable_trading', 'true'::jsonb, 'features', 'Enable item trading system');

-- Insert default feature flags
INSERT INTO feature_flags (flag, enabled, rollout_percentage, description) VALUES
('new_editor', true, 100, 'New rich text editor'),
('ai_moderation', true, 100, 'AI-powered content moderation'),
('live_streaming', false, 0, 'Live streaming feature'),
('mobile_app_api', true, 100, 'Mobile app API endpoints'),
('beta_features', false, 10, 'Beta features for selected users');

-- =====================================================
-- PERMISSIONS AND SECURITY
-- =====================================================

-- Create read-only role for analytics
CREATE ROLE analytics_readonly;
GRANT CONNECT ON DATABASE sparkle_universe TO analytics_readonly;
GRANT USAGE ON SCHEMA public TO analytics_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_readonly;

-- Create application role
CREATE ROLE app_user;
GRANT CONNECT ON DATABASE sparkle_universe TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Row Level Security policies would go here for multi-tenant scenarios

-- =====================================================
-- END OF SCHEMA
-- =====================================================
