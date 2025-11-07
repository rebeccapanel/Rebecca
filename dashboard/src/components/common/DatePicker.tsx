import type { ForwardedRef } from "react";
import { forwardRef } from "react";
import ReactDatePicker from "react-datepicker";

const DatePicker = forwardRef((props: any, ref: ForwardedRef<ReactDatePicker>) => (
  <ReactDatePicker {...props} ref={ref} />
));

DatePicker.displayName = "DatePicker";

export default DatePicker;

