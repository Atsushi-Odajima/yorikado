import { z } from 'zod';

/** Bank account input (Japanese domestic). Stored only AES-GCM encrypted. */
export const BankInput = z.object({
  bankName: z.string().trim().min(1, '金融機関名を入力してください').max(40),
  branchName: z.string().trim().min(1, '支店名を入力してください').max(40),
  accountType: z.enum(['ordinary', 'current']),
  accountNumber: z
    .string()
    .transform((v) => v.normalize('NFKC').replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{7}$/, '口座番号は7桁の数字です')),
  holderName: z.string().trim().min(1, '口座名義を入力してください').max(60),
});
export type BankInput = z.infer<typeof BankInput>;

export function maskedLabel(b: BankInput): { label: string; suffix: string } {
  const suffix = b.accountNumber.slice(-4);
  return { label: `${b.bankName} ${b.branchName} ${b.accountType === 'ordinary' ? '普通' : '当座'} ****${suffix}`, suffix };
}
