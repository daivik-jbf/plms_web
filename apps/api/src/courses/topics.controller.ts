import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type UpdateTopicInput, updateTopicSchema } from './courses.schemas';
import { TopicsService, type TopicView } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Patch(':id')
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTopicSchema)) body: UpdateTopicInput,
  ): Promise<TopicView> {
    return this.topics.edit(actor, id, body);
  }
}
