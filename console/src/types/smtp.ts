export interface SmtpStatus {
  available: boolean
  source: 'workspace' | 'global' | 'none'
  from_email?: string
}

export interface SmtpSettings {
  enabled: boolean
  host: string
  port: number
  username?: string
  password?: string
  from_name: string
  from_email: string
}

export interface SmtpInfo {
  status: SmtpStatus
  settings: SmtpSettings | null
}

export interface SmtpSettingsForm {
  enabled: boolean
  host: string
  port: number
  username?: string
  password?: string
  from_name: string
  from_email: string
}

export interface UpdateSmtpInput {
  enabled: boolean
  host: string
  port: number
  username?: string
  password?: string
  from_name: string
  from_email: string
}

export interface DeleteSmtpInput {
  workspace_id: string
}

export interface TestSmtpInput {
  workspace_id: string
  to_email: string
}

export interface TestSmtpResponse {
  success: boolean
  message: string
}
