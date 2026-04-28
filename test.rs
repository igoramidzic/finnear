use std::io::{stdin, stdout, Write};

fn main() {
    let mut input = String::new();
    println!("Hello, world!");
    
    stdin().read_line(&mut input).unwrap();
    println!("You said: {}", input);
}
