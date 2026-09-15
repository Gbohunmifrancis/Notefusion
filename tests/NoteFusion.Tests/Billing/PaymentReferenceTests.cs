using NoteFusion.Core.ValueObjects;

namespace NoteFusion.Tests.Billing;

public class PaymentReferenceTests
{
    [Fact]
    public void Generate_creates_reference_with_prefix()
    {
        var ref1 = PaymentReference.Generate("NF");
        var ref2 = PaymentReference.Generate("FLW");

        Assert.StartsWith("NF_", ref1.Value);
        Assert.StartsWith("FLW_", ref2.Value);
        Assert.NotEqual(ref1.Value, ref2.Value);
    }

    [Fact]
    public void Generate_defaults_to_nf_when_prefix_empty()
    {
        var reference = PaymentReference.Generate("");

        Assert.StartsWith("NF_", reference.Value);
    }

    [Theory]
    [InlineData("NF_1234567890")]
    [InlineData("tx-flw-998811")]
    [InlineData("SUB_REC_ABCD_EFGH")]
    public void Create_with_valid_string_succeeds(string valid)
    {
        var reference = PaymentReference.Create(valid);

        Assert.Equal(valid, reference.Value);
        Assert.Equal(valid, (string)reference);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("123")] // Too short (< 5 chars)
    public void Create_with_invalid_length_throws(string invalid)
    {
        Assert.Throws<ArgumentException>(() => PaymentReference.Create(invalid));
    }

    [Theory]
    [InlineData("NF@12345!")]
    [InlineData("ref with spaces")]
    [InlineData("tx#hash%")]
    public void Create_with_special_characters_throws(string invalidChars)
    {
        Assert.Throws<ArgumentException>(() => PaymentReference.Create(invalidChars));
    }

    [Fact]
    public void ToString_returns_inner_value()
    {
        var reference = PaymentReference.Create("NF_test_reference");

        Assert.Equal("NF_test_reference", reference.ToString());
    }
}
