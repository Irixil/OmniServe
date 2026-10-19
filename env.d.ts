declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    STAFF_USER_IDS?: string;
    STAFF_EMAILS?: string;
    PUBLISHER_USER_IDS?: string;
    PUBLISHER_EMAILS?: string;
    PROJECT_LEAD_USER_IDS?: string;
    PROJECT_LEAD_EMAILS?: string;
    AI_MODEL_ENABLED?: string;
    LOCAL_CODEX_ENABLED?: string;
    LOCAL_CODEX_BASE_URL?: string;
    LOCAL_CODEX_TOKEN?: string;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_BASE_URL?: string;
    DEEPSEEK_MODEL?: string;
    DEEPSEEK_VISION_MODEL?: string;
    AIHUBMIX_API_KEY?: string;
    AIHUBMIX_BASE_URL?: string;
    AIHUBMIX_MODEL?: string;
    AIHUBMIX_EMBEDDING_MODEL?: string;
    AI_VISION_ENABLED?: string;
    AIHUBMIX_VISION_MODEL?: string;
  }
}
