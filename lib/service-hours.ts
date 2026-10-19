import type { Locale } from './public-domain.ts';

export const SERVICE_TIME_ZONE = 'Asia/Shanghai';
export const SERVICE_START_HOUR = 10;
export const SERVICE_END_HOUR = 22;

export function isHumanTeamOnDuty(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hourCycle: 'h23', timeZone: SERVICE_TIME_ZONE,
  }).formatToParts(now).find((part) => part.type === 'hour')?.value ?? -1);
  return hour >= SERVICE_START_HOUR && hour < SERVICE_END_HOUR;
}

export function humanAvailabilityCopy(locale: Locale, now = new Date()) {
  if (isHumanTeamOnDuty(now)) return locale === 'zh'
    ? '项目专员今天可在北京时间 22:00 前跟进。你也可以继续在这里补充信息。'
    : 'A project specialist is available until 22:00 Beijing time today. You can continue adding details here.';
  return locale === 'zh'
    ? '你可以随时在这里提交咨询，项目专员会在下一个服务时段跟进；服务时段每天从北京时间 10:00 开始。'
    : 'You can leave your enquiry here at any time. A project specialist can follow up from 10:00 Beijing time in the next service window.';
}
