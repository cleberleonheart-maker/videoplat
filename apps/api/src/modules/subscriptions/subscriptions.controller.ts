import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.subscriptions.listSubscribedChannels(user.id);
  }

  @Post(':handle')
  subscribe(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.subscriptions.subscribe(user.id, handle);
  }

  @Delete(':handle')
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Param('handle') handle: string,
  ) {
    return this.subscriptions.unsubscribe(user.id, handle);
  }
}
