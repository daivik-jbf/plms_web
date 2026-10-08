import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, PasswordResetService, TokenService, AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard, PasswordService, TokenService, SessionService],
})
export class AuthModule {}
