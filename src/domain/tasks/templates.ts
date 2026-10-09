import { z } from 'zod';

export const TaskType = z.enum(['notice', 'event', 'closure', 'photo', 'shop_change']);
export type TaskType = z.infer<typeof TaskType>;

export type QuestionKind = 'choice' | 'text' | 'dates' | 'photos' | 'number';
export interface Question {
  id: string;
  label: string;
  kind: QuestionKind;
  required?: boolean;
  options?: string[];
  help?: string;
}
export interface TaskDefinition {
  questions: Question[];
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  notice: '回覧',
  event: 'イベント出欠',
  closure: '休業日',
  photo: '写真報告',
  shop_change: '店舗情報変更',
};

/** Action label for the merchant's primary button (spec: say what happens). */
export const TASK_ACTION_LABEL: Record<TaskType, string> = {
  notice: '確認しました',
  event: '出欠を回答する',
  closure: '休業日を届ける',
  photo: '写真報告を提出する',
  shop_change: '変更を申請する',
};

/** Default templates (office can edit before publishing; max 5 questions). */
export const TEMPLATES: Record<TaskType, TaskDefinition> = {
  notice: { questions: [] },
  event: {
    questions: [
      { id: 'attend', label: '参加しますか', kind: 'choice', required: true, options: ['参加', '不参加', '未定'] },
      { id: 'people', label: '参加人数', kind: 'number' },
      { id: 'note', label: '補足', kind: 'text' },
    ],
  },
  closure: {
    questions: [
      { id: 'dates', label: '休業する日', kind: 'dates', required: true },
      { id: 'note', label: '理由・補足', kind: 'text' },
    ],
  },
  photo: {
    questions: [
      { id: 'photos', label: '掲示の写真（3枚まで）', kind: 'photos', required: true },
      { id: 'note', label: '補足', kind: 'text' },
    ],
  },
  shop_change: {
    questions: [
      { id: 'display_name', label: '新しい店名', kind: 'text' },
      { id: 'address', label: '新しい住所', kind: 'text' },
      { id: 'contact_phone', label: '新しい電話番号', kind: 'text' },
      { id: 'note', label: '変更の理由', kind: 'text' },
    ],
  },
};

/** Build a client/server validator for a published definition. */
export function payloadSchema(def: TaskDefinition) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of def.questions) {
    let s: z.ZodTypeAny;
    switch (q.kind) {
      case 'choice':
        s = z.enum((q.options ?? ['-']) as [string, ...string[]], { message: '選択肢から選んでください' });
        break;
      case 'text':
        s = z.string().max(1000, '1000文字までです');
        break;
      case 'number':
        s = z.number().int().min(0).max(999999);
        break;
      case 'dates':
        s = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(31);
        break;
      case 'photos':
        s = z.array(z.string().uuid()).max(3, '写真は3枚までです');
        break;
    }
    if (q.required) {
      if (q.kind === 'dates' || q.kind === 'photos') s = (s as z.ZodArray<z.ZodTypeAny>).min(1, '必須です');
      else if (q.kind === 'text') s = z.string().trim().min(1, '必須です').max(1000);
    } else {
      s = s.optional();
    }
    shape[q.id] = s;
  }
  return z.object(shape).strict();
}

export const TASK_STATE_LABEL: Record<string, string> = {
  unanswered: '未回答',
  returned: '差戻し',
  pending_review: '事務局の確認待ち',
  done: '回答済み',
};
