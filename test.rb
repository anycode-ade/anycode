# Ruby syntax highlighting test

class Greeter
  DEFAULT_GREETING = "Hello"

  attr_reader :name

  def initialize(name)
    @name = name
  end

  def greet(excited: false)
    message = "#{DEFAULT_GREETING}, #{@name}"
    excited ? "#{message}!" : message
  end
end

users = %w[Alice Bob Charlie]
greeters = users.map { |name| Greeter.new(name) }

greeters.each_with_index do |greeter, index|
  puts greeter.greet(excited: index.zero?)
end

begin
  result = 10 / 0
  puts result
rescue ZeroDivisionError => error
  warn "Ruby error: #{error.message}"
ensure
  puts :finished
end
