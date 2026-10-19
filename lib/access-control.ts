function members(value?: string) {
  return new Set((value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function memberAccess(userId: string, email: string, configuredUserIds?: string, configuredEmails?: string) {
  const userIds = members(configuredUserIds);
  const emails = members(configuredEmails);
  if (!userIds.size && !emails.size) return 'unconfigured' as const;
  return userIds.has(userId.trim().toLowerCase()) || emails.has(email.trim().toLowerCase()) ? 'allowed' as const : 'denied' as const;
}
