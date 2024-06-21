import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto } from './dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from 'src/interface/order-with-products.interface';
import { PaidOrderDto } from './dto/paid-order.dtp';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('OrderService');
  constructor(
    @Inject(NATS_SERVICE)
    private readonly client: ClientProxy,
  ) {
    super();
  }
  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }
  async create(createOrderDto: CreateOrderDto) {
    try {
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds),
      );
      const totalAmount = createOrderDto.items.reduce((acc, orderItems) => {
        const price = products.find(
          (product) => product.id === orderItems.productId,
        ).price;
        return price * orderItems.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItems) => {
        return acc + orderItems.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItems) => ({
                price: products.find(
                  (product) => product.id === orderItems.productId,
                ).price,
                productId: orderItems.productId,
                quantity: orderItems.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            },
          },
        },
      });

      return {
        ...order,

        OrderItem: order.OrderItem.map((orderItems) => ({
          ...orderItems,
          name: products.find((product) => product.id === orderItems.productId)
            .name,
        })),
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status,
      },
    });

    const currentPages = orderPaginationDto.page;
    const perPages = orderPaginationDto.limit;
    return {
      data: await this.order.findMany({
        skip: (currentPages - 1) * perPages,
        take: perPages,
        where: {
          status: orderPaginationDto.status,
        },
      }),
      meta: {
        totalPages: totalPages,
        currentPages: currentPages,
        lastPage: Math.ceil(totalPages / currentPages),
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    const productIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds),
    );
    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const order = await this.findOne(id);

    if (order.status === status) {
      return order;
    }

    return this.order.update({
      where: { id },
      data: { status: status },
    });
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItem.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
      }),
    );
    return paymentSession;
  }

  async orderPaid(paidOrderDto: PaidOrderDto) {


    this.logger.log('Order pagada!')
    const order = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        paid: true,
        status: 'PAID',
        createdAt: new Date(),
        stripeId: paidOrderDto.stripeId,
        OrderReceipt: {
          create: {
            receipt_url: paidOrderDto.receipt_url,
          },
        },
      },
    });

    return order
  }
}
