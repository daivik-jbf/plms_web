import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, TokenService, AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard, PasswordService, TokenService, SessionService],
})
export class AuthModule {}
