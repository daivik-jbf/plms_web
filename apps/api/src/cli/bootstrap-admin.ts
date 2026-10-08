import { eq } from 'drizzle-orm';
import { emailSchema, nameSchema } from '../common/fields';
import type { Database } from '../db/db.module';
import { users } from '../db/schema';
import type { InvitesService } from '../invites/invites.service';

export async function bootstrapAdmin(
  deps: { invites: InvitesService; db: Database },
  rawEmail: string,
  rawName: string,
): Promise<string> {
  const email = emailSchema.safeParse(rawEmail);
  const name = nameSchema.safeParse(rawName);
  if (!email.success || !name.success) {
    const problems = [...(email.success ? [] : email.error.issues), ...(name.success ? [] : name.error.issues)];
    throw new Error(`Invalid email or name: ${problems.map((issue) => issue.message).join(' ')}`);
  }

  const [existingAdmin] = await deps.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (existingAdmin) {
    throw new Error('An Admin already exists. Invite more people from the portal.');
  }

  const pending = await deps.invites.findPendingByEmail(email.data);
  const result = pending
    ? await deps.invites.resend(null, pending.id, { sendEmail: false })
    : await deps.invites.create(null, { email: email.data, name: name.data, role: 'admin' }, { sendEmail: false });
  return result.link;
}
