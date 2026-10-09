import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { categoryFromSlug, type MediaCategory } from './media-kinds';

// Turns the route's category slug (videos, movies, podcasts, songs) into the database category. Anything else is
// not a page that exists, so it is a 404.
@Injectable()
export class CategoryPipe implements PipeTransform<string, MediaCategory> {
  transform(value: string): MediaCategory {
    const category = categoryFromSlug(value);
    if (!category) throw new NotFoundException('Not found.');
    return category;
  }
}
