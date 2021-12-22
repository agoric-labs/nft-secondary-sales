import React from 'react';
import Button from './common/Button';
import DateTimeField from './common/DateTimeField';
import Input from './common/InputField';
import Select from './common/SelectField';

function SellProductForm() {
  return (
    <div className="form flex flex-col gap-y-6 self">
      <Select />
      <Input />
      <DateTimeField />
      <Button styles="w-full mt-auto" />
    </div>
  );
}

export default SellProductForm;