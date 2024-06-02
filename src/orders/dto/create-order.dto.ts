import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';


import { Type } from 'class-transformer';
import { OrderItemsDto } from '.';

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemsDto)
  items: OrderItemsDto[];
}
