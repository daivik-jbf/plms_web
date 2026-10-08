import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  type ChangePasswordInput,
  changePasswordSchema,
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type SessionTokenInput,
  sessionTokenSchema,
} from './auth.schemas';
import { type LoginResult, AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy';
import { PasswordResetService } from './password-reset.service';
import { Public } from './public.decorator';
import { REFRESH_TTL_MS } from './session.service';

export const REFRESH_COOKIE = 'jbf_rt';
const authThrottle = { default: { limit: 20, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly resets: PasswordResetService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(authThrottle)
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, body.client, await this.auth.login(body));
  }

  @Public()
  @Throttle(authThrottle)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body(new ZodPipe(sessionTokenSchema)) body: SessionTokenInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const token = this.readRefreshToken(req, body);
      if (!token) {
        throw new UnauthorizedException('Session expired. Please sign in again.');
      }
      return this.respond(res, body.client, await this.auth.refresh(token, body.client));
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.clearCookie(res, body.client);
      }
      throw error;
    }
  }

  @Public()
  @Throttle(authThrottle)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body(new ZodPipe(sessionTokenSchema)) body: SessionTokenInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshToken(req, body));
    this.clearCookie(res, body.client);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user);
    this.clearCookie(res, 'web');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput): Promise<{ message: string }> {
    await this.resets.request(body.email);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput): Promise<void> {
    await this.resets.reset(body.token, body.newPassword);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.resets.change(user, body.currentPassword, body.newPassword);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Public()
  @Get('password-policy')
  passwordPolicy(): { minLength: number; maxLength: number } {
    return { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH };
  }

  private readRefreshToken(req: Request, body: SessionTokenInput): string | null {
    if (body.client === 'mobile') {
      return body.refreshToken ?? null;
    }
    if (req.header('x-requested-with') !== 'jbf-web') {
      throw new ForbiddenException('Missing required header.');
    }
    const cookie: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof cookie === 'string' ? cookie : null;
  }

  private respond(res: Response, client: 'web' | 'mobile', result: LoginResult) {
    const { refreshToken, ...rest } = result;
    if (client === 'web') {
      res.cookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: REFRESH_TTL_MS,
      });
      return rest;
    }
    return { ...rest, refreshToken };
  }

  private clearCookie(res: Response, client: 'web' | 'mobile'): void {
    if (client === 'web') {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    }
  }
}
