export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      agent_status: {
        Row: {
          hostname: string | null
          id: number
          last_seen: string | null
          version: string | null
        }
        Insert: {
          hostname?: string | null
          id?: number
          last_seen?: string | null
          version?: string | null
        }
        Update: {
          hostname?: string | null
          id?: number
          last_seen?: string | null
          version?: string | null
        }
        Relationships: []
      }
      console_connect_settings: {
        Row: {
          api_url: string
          client_id: string
          integration: string
          password_cipher: string | null
          token_url: string
          updated_at: string
          username: string
        }
        Insert: {
          api_url: string
          client_id?: string
          integration: string
          password_cipher?: string | null
          token_url?: string
          updated_at?: string
          username?: string
        }
        Update: {
          api_url?: string
          client_id?: string
          integration?: string
          password_cipher?: string | null
          token_url?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      database_connections: {
        Row: {
          created_at: string
          database_name: string
          host: string
          id: string
          label: string
          password_cipher: string | null
          port: number
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          database_name?: string
          host: string
          id?: string
          label: string
          password_cipher?: string | null
          port?: number
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          database_name?: string
          host?: string
          id?: string
          label?: string
          password_cipher?: string | null
          port?: number
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      device_logs: {
        Row: {
          created_at: string
          date: string
          event: string | null
          id: number
          ip: string
          message: string | null
          site_id: string | null
          time: string
        }
        Insert: {
          created_at?: string
          date: string
          event?: string | null
          id?: never
          ip: string
          message?: string | null
          site_id?: string | null
          time: string
        }
        Update: {
          created_at?: string
          date?: string
          event?: string | null
          id?: never
          ip?: string
          message?: string | null
          site_id?: string | null
          time?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          arm_version: string | null
          created_at: string
          id: number
          ip: string
          kernel_version: string | null
          last_log_pulled_at: string | null
          mib_version: string | null
          name: string | null
          serial_number: string | null
          site_id: string | null
          stm32_version: string | null
          updated_at: string
          web_version: string | null
        }
        Insert: {
          arm_version?: string | null
          created_at?: string
          id?: never
          ip: string
          kernel_version?: string | null
          last_log_pulled_at?: string | null
          mib_version?: string | null
          name?: string | null
          serial_number?: string | null
          site_id?: string | null
          stm32_version?: string | null
          updated_at?: string
          web_version?: string | null
        }
        Update: {
          arm_version?: string | null
          created_at?: string
          id?: never
          ip?: string
          kernel_version?: string | null
          last_log_pulled_at?: string | null
          mib_version?: string | null
          name?: string | null
          serial_number?: string | null
          site_id?: string | null
          stm32_version?: string | null
          updated_at?: string
          web_version?: string | null
        }
        Relationships: []
      }
      helper_enrollments: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      helper_settings: {
        Row: {
          agent_token_cipher: string | null
          config_version: number
          firewall_rules: Json
          id: number
          ntp_settings: Json
          updated_at: string
          ur35_firewall_path: string
          ur35_ntp_path: string
          ur35_password_cipher: string | null
          ur35_username: string
        }
        Insert: {
          agent_token_cipher?: string | null
          config_version?: number
          firewall_rules?: Json
          id?: number
          ntp_settings?: Json
          updated_at?: string
          ur35_firewall_path?: string
          ur35_ntp_path?: string
          ur35_password_cipher?: string | null
          ur35_username?: string
        }
        Update: {
          agent_token_cipher?: string | null
          config_version?: number
          firewall_rules?: Json
          id?: number
          ntp_settings?: Json
          updated_at?: string
          ur35_firewall_path?: string
          ur35_ntp_path?: string
          ur35_password_cipher?: string | null
          ur35_username?: string
        }
        Relationships: []
      }
      okta_settings: {
        Row: {
          client_id: string
          client_secret_cipher: string | null
          domain: string
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id?: string
          client_secret_cipher?: string | null
          domain?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          client_secret_cipher?: string | null
          domain?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      sim_activations: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          iccid: string
          id: string
          ip: string | null
          simulated: boolean
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          iccid: string
          id?: string
          ip?: string | null
          simulated?: boolean
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          iccid?: string
          id?: string
          ip?: string | null
          simulated?: boolean
          status?: string
        }
        Relationships: []
      }
      site_checks: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ip: string
          network: string | null
          ping: Json | null
          ports: Json
          site_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ip: string
          network?: string | null
          ping?: Json | null
          ports?: Json
          site_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ip?: string
          network?: string | null
          ping?: Json | null
          ports?: Json
          site_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "operator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator"],
    },
  },
} as const
