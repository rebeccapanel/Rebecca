import type { ComponentType } from "react";

declare module "react-datepicker" {
  const ReactDatePicker: ComponentType<any>;
  export default ReactDatePicker;
}
