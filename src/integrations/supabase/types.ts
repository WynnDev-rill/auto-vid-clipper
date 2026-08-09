export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.15" }
  public: {
    Tables: {
      clipforge_clips: {
        Row: {
          created_at: string
          description: string | null
          duration_s: number | null
          hashtags: string[]
          id: string
          job_id: string
          order_index: number
          status: string
          subtitle_style: Json
          subtitle_template: string
          tags: string[]
          thumbnail_text: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_s?: number | null
          hashtags?: string[]
          id?: string
          job_id: string
          order_index?: number
          status?: string
          subtitle_style?: Json
          subtitle_template?: string
          tags?: string[]
          thumbnail_text?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_s?: number | null
          hashtags?: string[]
          id?: string
          job_id?: string
          order_index?: number
          status?: string
          subtitle_style?: Json
          subtitle_template?: string
          tags?: string[]
          thumbnail_text?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_url?: string | null
        }
        Relationships: [{
          foreignKeyName: "clipforge_clips_job_id_fkey"
          columns: ["job_id"]
          isOneToOne: false
          referencedRelation: "clipforge_jobs"
          referencedColumns: ["id"]
        }]
      }
      clipforge_jobs: {
        Row: {
          backend_job_id: string | null
          clip_count: number
          clip_duration: number
          completed_clips: number
          created_at: string
          error_message: string | null
          estimated_remaining_s: number | null
          id: string
          last_heartbeat_at: string | null
          progress: number
          source_duration_s: number | null
          source_title: string | null
          source_type: string
          source_upload_path: string | null
          source_url: string | null
          stage: string | null
          stage_started_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          backend_job_id?: string | null
          clip_count: number
          clip_duration: number
          completed_clips?: number
          created_at?: string
          error_message?: string | null
          estimated_remaining_s?: number | null
          id?: string
          last_heartbeat_at?: string | null
          progress?: number
          source_duration_s?: number | null
          source_title?: string | null
          source_type: string
          source_upload_path?: string | null
          source_url?: string | null
          stage?: string | null
          stage_started_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          backend_job_id?: string | null
          clip_count?: number
          clip_duration?: number
          completed_clips?: number
          created_at?: string
          error_message?: string | null
          estimated_remaining_s?: number | null
          id?: string
          last_heartbeat_at?: string | null
          progress?: number
          source_duration_s?: number | null
          source_title?: string | null
          source_type?: string
          source_upload_path?: string | null
          source_url?: string | null
          stage?: string | null
          stage_started_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clipforge_profiles: {
        Row: { id: string; display_name: string | null; avatar_url: string | null; created_at: string; updated_at: string }
        Insert: { id: string; display_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; display_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      clipforge_uploads: {
        Row: {
          clip_id: string
          created_at: string
          description: string | null
          error_message: string | null
          id: string
          scheduled_for: string | null
          simulated: boolean
          status: string
          title: string | null
          updated_at: string
          uploaded_at: string | null
          user_id: string
          visibility: string
          youtube_video_id: string | null
        }
        Insert: {
          clip_id: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          scheduled_for?: string | null
          simulated?: boolean
          status?: string
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id: string
          visibility?: string
          youtube_video_id?: string | null
        }
        Update: {
          clip_id?: string
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          scheduled_for?: string | null
          simulated?: boolean
          status?: string
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id?: string
          visibility?: string
          youtube_video_id?: string | null
        }
        Relationships: [{
          foreignKeyName: "clipforge_uploads_clip_id_fkey"
          columns: ["clip_id"]
          isOneToOne: false
          referencedRelation: "clipforge_clips"
          referencedColumns: ["id"]
        }]
      }
      clipforge_user_settings: {
        Row: { created_at: string; notifications_enabled: boolean; theme: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; notifications_enabled?: boolean; theme?: string; updated_at?: string; user_id: string }
        Update: { created_at?: string; notifications_enabled?: boolean; theme?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      clipforge_youtube_connections: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          channel_id: string | null
          channel_thumbnail: string | null
          channel_title: string | null
          created_at: string
          refresh_token_ciphertext: string
          scopes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          channel_id?: string | null
          channel_thumbnail?: string | null
          channel_title?: string | null
          created_at?: string
          refresh_token_ciphertext: string
          scopes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          channel_id?: string | null
          channel_thumbnail?: string | null
          channel_title?: string | null
          created_at?: string
          refresh_token_ciphertext?: string
          scopes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T] extends { Row: infer R } ? R : never
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never

export const Constants = { public: { Enums: {} } } as const
