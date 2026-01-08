import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsWithinTimeBounds(
  hours: number,
  direction: 'past' | 'future' | 'both',
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWithinTimeBounds',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [hours, direction],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'number') return false;

          const [hours, direction] = args.constraints as [
            number,
            'past' | 'future' | 'both',
          ];
          const now = Date.now();
          const boundMs = hours * 60 * 60 * 1000;

          if (direction === 'past' || direction === 'both') {
            if (value < now - boundMs) return false;
          }
          if (direction === 'future' || direction === 'both') {
            if (value > now + boundMs) return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const [hours, direction] = args.constraints as [
            number,
            'past' | 'future' | 'both',
          ];
          if (direction === 'past') {
            return `${args.property} must not be more than ${hours} hours in the past`;
          }
          if (direction === 'future') {
            return `${args.property} must not be more than ${hours} hours in the future`;
          }
          return `${args.property} must be within ${hours} hours of current time`;
        },
      },
    });
  };
}
