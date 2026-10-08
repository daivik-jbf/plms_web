import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TEST_PASSWORD } from './users';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export async function loginMobile(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password, client: 'mobile' })
    .expect(200);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

export const bearer = (session: Session): [string, string] => ['Authorization', `Bearer ${session.accessToken}`];
